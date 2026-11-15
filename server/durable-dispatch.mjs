import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

// A durable claim exists before the executor runs. An interrupted claim is
// deliberately IN_DOUBT: re-running an unknown external side effect is unsafe.
export function createDispatchJournal(directory) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('journal directory is required');
  const root = path.resolve(directory);
  const filename = key => path.join(root, createHash('sha256').update(key).digest('hex') + '.json');
  async function prepare() {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('dispatch journal must be a real directory');
  }
  async function readRecord(file) {
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const record = JSON.parse(await handle.readFile('utf8'));
      if (!record || record.schema_version !== 1 || !['pending', 'completed'].includes(record.status)
          || typeof record.envelope_digest !== 'string' || record.envelope_digest.length !== 64
          || (record.status === 'completed' && (!record.payload || typeof record.payload.success !== 'boolean'))) {
        throw new Error('Invalid persisted dispatch journal entry');
      }
      return record;
    } finally { await handle.close(); }
  }
  async function reserve(key, envelopeDigest) {
    if (typeof key !== 'string' || !key || !/^[a-f0-9]{64}$/.test(envelopeDigest)) {
      throw new TypeError('invalid dispatch identity');
    }
    await prepare();
    const file = filename(key);
    let handle;
    try {
      handle = await open(file, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ schema_version: 1, status: 'pending', envelope_digest: envelopeDigest }) + '\n');
      await handle.sync();
      const directoryHandle = await open(root, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      return { state: 'reserved' };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally { if (handle) await handle.close(); }
    // Another process may still be writing its exclusive claim. Never retry
    // the execution when the record is incomplete or corrupt.
    const record = await readRecord(file).catch(() => null);
    if (!record) return { state: 'in_doubt' };
    if (record.envelope_digest !== envelopeDigest) return { state: 'conflict' };
    if (record.status === 'completed') return { state: 'replay', payload: record.payload };
    return { state: 'in_doubt' };
  }
  async function complete(key, envelopeDigest, payload) {
    const file = filename(key);
    const current = await readRecord(file);
    if (current.envelope_digest !== envelopeDigest || current.status !== 'pending') {
      throw new Error('Dispatch journal claim changed before completion');
    }
    if (!payload || typeof payload.success !== 'boolean' || !payload.receipt) {
      throw new TypeError('dispatch completion requires a result and receipt');
    }
    const temporary = file + '.' + process.pid + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ schema_version: 1, status: 'completed', envelope_digest: envelopeDigest, payload }) + '\n');
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, file);
      const directoryHandle = await open(root, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  return { reserve, complete };
}
