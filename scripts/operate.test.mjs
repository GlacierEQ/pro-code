import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('./operate.py', import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pro-code-operator-'));
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', noEmit: true }, include: ['src/**/*.ts'],
  }));
  writeFileSync(path.join(root, 'src', 'util.ts'), 'export function rocketLaunch() { return 42; }\n');
  writeFileSync(path.join(root, 'src', 'main.ts'), 'const n = rocketLaunch();\n');
  writeFileSync(path.join(root, 'verify.test.mjs'), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { readFileSync } from 'node:fs';",
    "test('actual repaired source',()=>{",
    "const source=readFileSync(new URL('./src/main.ts',import.meta.url),'utf8');",
    "assert.match(source,/import.*rocketLaunch.*from/);",
    "});",
  ].join('\n'));
  return root;
}
function run(args, timeout = 90_000) {
  return spawnSync(python, [cli, ...args], {encoding:'utf8',timeout});
}
function cleanup(root) { rmSync(root, {recursive:true,force:true}); }

test('operator inspect discovers an actual compiler diagnostic without writing source', () => {
  const root=fixture();
  try {
    const original=readFileSync(path.join(root,'src/main.ts'),'utf8');
    const result=run(['inspect','--workspace',root,'--file','src/main.ts']);
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.operation,'typescript_code_fix_inventory');
    assert.equal(report.source_modified,false);
    assert.ok(report.diagnostics.some(x=>x.code===2304));
    assert.equal(readFileSync(path.join(root,'src/main.ts'),'utf8'),original);
  } finally {cleanup(root);}
});

test('operator repairs real code only when an independent test passes after application', () => {
  const root=fixture();
  try {
    const result=run(['repair','--workspace',root,'--file','src/main.ts',
      '--code','2304','--verify-test','verify.test.mjs']);
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.operation,'verified_typescript_code_repair');
    assert.equal(report.outcome,'verified_code_repair');
    assert.equal(report.baseline.passed,false);
    assert.equal(report.verification.passed,true);
    assert.equal(report.verification.new_project_diagnostic_count,0);
    assert.equal(report.source_modified,true);
    assert.equal(Object.hasOwn(report,'workspace'),false);
    assert.match(readFileSync(path.join(root,'src/main.ts'),'utf8'),/import.*rocketLaunch.*from/);
  } finally {cleanup(root);}
});

test('operator preserves native failed repair evidence and original source', () => {
  const root=fixture();
  const expected=readFileSync(path.join(root,'src/main.ts'),'utf8');
  writeFileSync(path.join(root,'verify.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('fails',()=>assert.equal(1,2));");
  try {
    const result=run(['repair','--workspace',root,'--file','src/main.ts',
      '--code','2304','--verify-test','verify.test.mjs']);
    assert.equal(result.status,1,result.stderr);
    const receipt=JSON.parse(result.stdout);
    assert.equal(receipt.outcome,'verification_failed_restored');
    assert.equal(receipt.source_modified,false);
    assert.equal(receipt.rollback.verified,true);
    assert.equal(readFileSync(path.join(root,'src/main.ts'),'utf8'),expected);
  } finally {cleanup(root);}
});

test('operator evaluates real loopback dispatch and admits only measured local evidence', () => {
  const result=run(['evaluate'],40_000);
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.evaluation_kind,'hermetic_real_http_ablation');
  assert.equal(report.compared.baseline.passed,4);
  assert.equal(report.compared.candidate.passed,7);
  assert.equal(report.evidence_gate.decision,'accept_local_component_evidence');
  assert.equal(report.evidence_gate.approval_to_deploy,false);
  assert.equal(report.model,null);
});

test('operator writes source-bound evidence once without stale-run overwrite', () => {
  const root=fixture();
  const destination=path.join(root,'evaluation.json');
  try {
    const first=run(['evaluate','--out',destination]);
    assert.equal(first.status,0,first.stderr);
    const original=readFileSync(destination,'utf8');
    assert.equal(JSON.parse(original).result,'local_ablation_improvement_verified');
    const second=run(['evaluate','--out',destination]);
    assert.equal(second.status,2);
    assert.equal(JSON.parse(second.stdout).status,'failed');
    assert.equal(readFileSync(destination,'utf8'),original);
    assert.equal(existsSync(destination+'.bridge.lock'),false);
  } finally {cleanup(root);}
});

test('npm operator launcher delegates to the actual Python tool and preserves the native output', () => {
  const root=fixture();
  const launcher=fileURLToPath(new URL('./operator-launch.mjs',import.meta.url));
  try {
    const result=spawnSync(process.execPath,[launcher,'inspect','--workspace',root,
      '--file','src/main.ts'],{encoding:'utf8',timeout:40_000});
    assert.equal(result.status,0,result.stderr);
    const report=JSON.parse(result.stdout);
    assert.equal(report.operation,'typescript_code_fix_inventory');
    assert.equal(report.source_modified,false);
    assert.ok(report.diagnostics.some(item=>item.code===2304));
  } finally {cleanup(root);}
});

test('operator refuses incomplete authority, fake success, unknown operations and invalid timeouts', () => {
  for (const args of [[],['pretend'],['repair','--file','src/main.ts'],['inspect'],
    ['evaluate','--file','src/main.ts'],['evaluate','--process-timeout','2'],
    ['inspect','--file','src/main.ts','--occurrence','2'],
    ['inspect','--file','src/main.ts','--timeout-ms','1000']]) {
    const result=run(args);
    assert.notEqual(result.status,0,'must reject '+args.join(' '));
    assert.doesNotMatch(result.stdout,/Runtime observed ok/);
  }
  const unsafe=run(['repair','--file','src/main.ts','--code','2304',
    '--verify-test','verify.test.mjs','--process-timeout','30']);
  assert.notEqual(unsafe.status,0);
  assert.match(unsafe.stderr,/unsafe for mutating repair/);
  const invalid=run(['inspect','--workspace','/path-that-does-not-exist',
    '--file','src/main.ts']);
  assert.notEqual(invalid.status,0);
  const receipt=JSON.parse(invalid.stdout);
  assert.equal(receipt.status,'failed');
  assert.equal(receipt.error_code,'command_unavailable');
});
