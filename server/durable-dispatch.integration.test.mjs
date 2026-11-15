import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createDispatchJournal } from './durable-dispatch.mjs';
import { startNexusServer } from './nexus.mjs';

const makeBody = key => ({
  schema_version: '1.0.0', case_id: 'workspace:local', trace_id: 'trace-'+key,
  task_id: 'task-'+key, idempotency_key: key, priority: 'normal',
  constraints: { human_review_required: false, external_actions: 'forbidden', max_runtime_ms: 30000, allowed_tools: [], source_refs: [] },
  producer: { system: 'pro-code', component: 'durability-test', version: '1.0.0' },
  worker: 'automation-orchestrator', capability: 'inventoryWorkspace',
  params: {}, created_at: '2026-11-15T00:00:00.000Z',
});
async function dispatch(url, body) {
  return fetch(url+'/api/v1/workers/'+body.worker+'/execute', { method:'POST',
    headers:{'Content-Type':'application/json','Idempotency-Key':body.idempotency_key,
      'X-Case-Id':body.case_id,'X-Trace-Id':body.trace_id}, body:JSON.stringify(body) });
}
async function close(server) { await new Promise((res, rej)=>server.close(e=>e?rej(e):res())); }

test('Nexus HTTP dispatch survives restart with exact original receipt and no second execution', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'pro-code-integration-'));
  const dir = path.join(root, 'journal');
  let executions = 0;
  const automation = { async executeCapability() {
    executions++;
    return { handled:true, operation:'workspace_inventory', verified:true, objective_completed:true,
      summary:{manifest_id:'fixture-sha256', inventory_complete:true, file_count:2, hash_complete:true, hash_skipped_files:0},
      artifacts:{manifest:'/fixture/manifest.json'} };
  }};
  let runtime;
  try {
    const body=makeBody('restart-key');
    runtime=await startNexusServer({host:'127.0.0.1',port:0,journalDir:dir,automation});
    const first=await dispatch(runtime.url,body);
    assert.equal(first.status,200);
    const receipt=await first.json();
    assert.equal(receipt.objective_completed,true);
    assert.equal(executions,1);
    await close(runtime.server); runtime=null;
    runtime=await startNexusServer({host:'127.0.0.1',port:0,journalDir:dir,automation});
    const again=await dispatch(runtime.url,body);
    assert.equal(again.status,200);
    assert.equal(again.headers.get('x-idempotent-replay'),'true');
    assert.deepEqual(await again.json(),receipt);
    assert.equal(executions,1,'restart replay must never rerun the action');
    const receiptListing = await fetch(runtime.url + '/api/v1/runtime/receipts');
    assert.equal(receiptListing.status, 200);
    assert.equal((await receiptListing.json()).receipts.length, 1,
      'a persisted replay must be observable in the runtime receipt listing');
    
    const conflict=await dispatch(runtime.url,{...body,params:{unexpected:'new'}});
    assert.equal(conflict.status,409);
    assert.equal(executions,1);
  } finally { if(runtime)await close(runtime.server);await rm(root,{recursive:true,force:true}); }
});

test('Nexus rejects abandoned durable claims without executing an uncertain operation', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'pro-code-interrupted-'));
  const dir=path.join(root,'journal');
  const body=makeBody('pending-key');
  const envelopeDigest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  let executed=0;
  let runtime;
  try {
    assert.equal((await createDispatchJournal(dir).reserve(body.idempotency_key,envelopeDigest)).state,'reserved');
    runtime=await startNexusServer({host:'127.0.0.1',port:0,journalDir:dir,automation:{async executeCapability(){executed++;return {handled:false};}}});
    const response=await dispatch(runtime.url,body);
    assert.equal(response.status,409);
    assert.match((await response.json()).error,/uncertain claim/);
    assert.equal(executed,0);
  } finally { if(runtime)await close(runtime.server);await rm(root,{recursive:true,force:true}); }
});
