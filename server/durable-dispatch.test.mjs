import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createDispatchJournal } from './durable-dispatch.mjs';

const digest = 'a'.repeat(64);
const payload = { status: 'succeeded', success: true, receipt: { receipt_id: 'receipt-1' } };
const withJournal = async fn => {
  const root = await mkdtemp(path.join(tmpdir(), 'pro-code-journal-'));
  try { await fn(createDispatchJournal(root), root); }
  finally { await rm(root, { recursive: true, force: true }); }
};

test('completed request replays after a new journal instance without executing again', async () => {
  await withJournal(async (journal, root) => {
    assert.deepEqual(await journal.reserve('key', digest), { state: 'reserved' });
    await journal.complete('key', digest, payload);
    assert.deepEqual(await createDispatchJournal(root).reserve('key', digest), { state: 'replay', payload });
    assert.deepEqual(await journal.reserve('key', 'b'.repeat(64)), { state: 'conflict' });
    const records = await readdir(root);
    assert.equal(records.length, 2);
    assert.equal(JSON.parse(await readFile(path.join(root, records.find(name => name.endsWith('.done'))), 'utf8')).status, 'completed');
  });
});

test('interrupted claim is in doubt, not silently retried, after restart', async () => {
  await withJournal(async (journal, root) => {
    assert.deepEqual(await journal.reserve('pending', digest), { state: 'reserved' });
    const restarted = createDispatchJournal(root);
    assert.deepEqual(await restarted.reserve('pending', digest), { state: 'in_doubt' });
    assert.deepEqual(await restarted.reserve('pending', 'b'.repeat(64)), { state: 'conflict' });
  });
});

test('parallel claims across journal instances have only one owner', async () => {
  await withJournal(async (_, root) => {
    const claims = await Promise.all(Array.from({ length: 100 }, () => createDispatchJournal(root).reserve('parallel', digest)));
    assert.equal(claims.filter(x => x.state === 'reserved').length, 1);
    assert.equal(claims.filter(x => x.state === 'in_doubt').length, 99);
  });
});

test('invalid or corrupt journal records fail closed rather than executing', async () => {
  await withJournal(async (journal, root) => {
    await assert.rejects(journal.reserve('', digest), /invalid dispatch/);
    await assert.rejects(journal.reserve('key', 'not-a-hash'), /invalid dispatch/);
    await journal.reserve('corrupt', digest);
    const files = await readdir(root);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(root, files[0]), '{bad-json');
    assert.deepEqual(await journal.reserve('corrupt', digest), { state: 'in_doubt' });
  });
});

test('two completion attempts cannot overwrite the first durable receipt', async () => {
  await withJournal(async (journal, root) => {
    await journal.reserve('write-once', digest);
    const different = { status: 'succeeded', success: true, receipt: { receipt_id: 'receipt-2' } };
    const results = await Promise.allSettled([
      journal.complete('write-once', digest, payload),
      createDispatchJournal(root).complete('write-once', digest, different),
    ]);
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(results.filter(x => x.status === 'rejected').length, 1);
    const replay = await journal.reserve('write-once', digest);
    assert.equal(replay.state, 'replay');
    assert.ok(['receipt-1', 'receipt-2'].includes(replay.payload.receipt.receipt_id));
  });
});
