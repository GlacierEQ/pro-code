import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startAutomaticRuntime } from './automatic-runtime.mjs';

test('default runtime starts Nexus and completes automatic workspace intelligence', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'pro-code-runtime-'));
  await writeFile(path.join(workspaceRoot, 'Hearing-Exhibit.txt'), 'verified fixture');
  const runtime = await startAutomaticRuntime({
    env: {
      PRO_CODE_HOST: '127.0.0.1',
      PRO_CODE_PORT: '0',
      PRO_CODE_WORKSPACE_DIR: workspaceRoot,
      PRO_CODE_AUTOMATION_ENABLED: 'true',
      PRO_CODE_AUTOMATION_INTERVAL_MS: '5000',
    },
  });

  try {
    const status = await runtime.startup;
    assert.equal(status.state, 'idle');
    assert.equal(status.latest.file_count, 1);
    assert.equal(status.latest.high_value_candidates, 1);

    const manifest = JSON.parse(await readFile(status.latest.manifest_path, 'utf8'));
    assert.equal(manifest.files[0].path, 'Hearing-Exhibit.txt');
    assert.equal(manifest.files[0].hash_status, 'hashed');

    const response = await fetch(`${runtime.url}/health`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.workers.length, 15);
  } finally {
    await runtime.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
