import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { inspectCodeFixes, planCodeFix, applyCodeFix, executeVerifiedCodeRepair } from './code-fix.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-code-fix-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', noEmit: true },
    include: ['src/**/*.ts'],
  }));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(root, 'src', name), body);
  return root;
}
const clean = root => fs.rmSync(root, { recursive: true, force: true });
const read = (root, file) => fs.readFileSync(path.join(root, 'src', file), 'utf8');
function firstFix(root, code = 2304) {
  const items = inspectCodeFixes({ root, file: 'src/main.ts' }).diagnostics.filter(d => d.code === code);
  assert.ok(items.length, 'fixture should produce TypeScript diagnostic ' + code);
  const candidate = items[0].actions.find(x => !x.requires_commands && x.file_count);
  assert.ok(candidate, 'compiler should offer a safe real code action');
  return planCodeFix({ root, file: 'src/main.ts', code, fixIndex: candidate.fix_index });
}

test('inventory lists real TS errors and compiler-generated fixes without writing', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'const n = rocketLaunch();\n' });
  try {
    const result = inspectCodeFixes({ root, file: 'src/main.ts' });
    assert.equal(result.operation, 'typescript_code_fix_inventory');
    assert.ok(result.diagnostics.some(d => d.code === 2304));
    assert.ok(result.diagnostics.find(d => d.code === 2304).actions.length);
    assert.equal(result.source_modified, false);
    assert.equal(read(root, 'main.ts'), 'const n = rocketLaunch();\n');
  } finally { clean(root); }
});

test('preview compiler auto-import then atomically apply real cross-file-aware correction', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'const n = rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    assert.equal(plan.mode, 'preview');
    assert.equal(plan.diagnostics_added, 0);
    assert.ok(plan.changed_files.some(f => f.path === 'src/main.ts'));
    assert.equal(read(root, 'main.ts'), 'const n = rocketLaunch();\n');
    const result = applyCodeFix(plan);
    assert.equal(result.mode, 'applied');
    assert.equal(result.readback_verified, true);
    assert.match(read(root, 'main.ts'), /import.*rocketLaunch.*from/);
    assert.equal(inspectCodeFixes({ root, file: 'src/main.ts' }).diagnostics.filter(d => d.code === 2304).length, 0);
  } finally { clean(root); }
});

test('stale preview fails closed and preserves independently modified source', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    fs.writeFileSync(path.join(root, 'src/main.ts'), '// editing concurrently\nrocketLaunch();\n');
    assert.throws(() => applyCodeFix(plan), /source changed after preview/);
    assert.equal(read(root, 'main.ts'), '// editing concurrently\nrocketLaunch();\n');
  } finally { clean(root); }
});

test('tampered plan fails closed, and applied plan cannot be replayed', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    assert.throws(() => applyCodeFix({ ...plan, description: 'different action' }), /plan changed/);
    assert.equal(read(root, 'main.ts'), 'rocketLaunch();\n');
    applyCodeFix(plan);
    assert.throws(() => applyCodeFix(plan), /source changed after preview/);
  } finally { clean(root); }
});

test('rejects invalid selection, outside workspace and symlinked project files', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pro-code-fix-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'secret.ts'), 'const secret = 1;');
    assert.throws(() => planCodeFix({ root, file: '../secret.ts', code: 2304 }), /escapes workspace/);
    assert.throws(() => planCodeFix({ root, file: 'src/main.ts', code: 2304, occurrence: 55 }), /occurrence not found/);
    assert.throws(() => planCodeFix({ root, file: 'src/main.ts', code: 2304, fixIndex: 999 }), /index not found/);
    assert.throws(() => planCodeFix({ root, file: 'src/main.ts', code: -1 }), /positive TypeScript diagnostic/);
    fs.symlinkSync(path.join(outside, 'secret.ts'), path.join(root, 'src', 'linked.ts'));
    assert.throws(() => planCodeFix({ root, file: 'src/linked.ts', code: 2304 }), /non-symlink workspace file/);
  } finally { clean(root); clean(outside); }
});

test('does not overwrite source on blocked transaction lock', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  try {
    const plan = firstFix(root);
    fs.mkdirSync(path.join(root, '.pro-code'));
    fs.writeFileSync(path.join(root, '.pro-code', 'semantic-refactor.lock'), 'already held');
    assert.throws(() => applyCodeFix(plan), /EEXIST/);
    assert.equal(read(root, 'main.ts'), 'rocketLaunch();\n');
  } finally { clean(root); }
});

test('CLI can list, preview and apply compiler fixes with machine-readable JSON', () => {
  const root = fixture({ 'util.ts': 'export function rocketLaunch() { return 42; }\n', 'main.ts': 'rocketLaunch();\n' });
  const cli = fileURLToPath(new URL('./code-fix.mjs', import.meta.url));
  try {
    const base = [cli, '--root', root, '--file', 'src/main.ts'];
    const listing = JSON.parse(execFileSync(process.execPath, base, { encoding: 'utf8' }));
    const action = listing.diagnostics.find(d => d.code === 2304).actions.find(a => !a.requires_commands);
    assert.ok(action);
    const preview = JSON.parse(execFileSync(process.execPath, [...base, '--code', '2304', '--fix-index', String(action.fix_index)], { encoding: 'utf8' }));
    assert.equal(preview.mode, 'preview');
    const applied = JSON.parse(execFileSync(process.execPath, [...base, '--code', '2304', '--fix-index', String(action.fix_index), '--apply'], { encoding: 'utf8' }));
    assert.equal(applied.mode, 'applied');
    assert.match(read(root, 'main.ts'), /import/);
    const bad = spawnSync(process.execPath, [...base, '--code', '2304', '--apply'], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally { clean(root); }
});


function createVerifier(root, body) {
  fs.writeFileSync(path.join(root, 'verify.test.mjs'), body);
  return 'verify.test.mjs';
}

test('repair executes real failing-then-passing independent acceptance test and validates actual source', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const verifyTest=createVerifier(root, `
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    test('code repair supplies missing auto-import', () => {
      const source=readFileSync(new URL('./src/main.ts',import.meta.url),'utf8');
      assert.match(source,/import.*rocketLaunch.*from/);
    });
  `);
  try {
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.operation,'verified_typescript_code_repair');
    assert.equal(result.baseline.passed,false);
    assert.equal(result.verification.passed,true);
    assert.equal(result.verification.compiler_diagnostic_after,0);
    assert.equal(result.verification.all_write_hashes_match,true);
    assert.equal(result.outcome,'verified_code_repair');
    assert.equal(result.source_modified,true);
    assert.match(result.plan_sha256,/^[0-9a-f]{64}$/);
    assert.match(read(root,'main.ts'),/import.*rocketLaunch.*from/);
  } finally {clean(root);}
});

test('failed independent acceptance test restores exact original bytes', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const original=read(root,'main.ts');
  const verifyTest=createVerifier(root, `
    import test from 'node:test';
    import assert from 'node:assert/strict';
    test('intentionally failing external regression',()=>assert.equal(1,2));
  `);
  try {
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.baseline.passed,false);
    assert.equal(result.verification.passed,false);
    assert.equal(result.outcome,'verification_failed_restored');
    assert.equal(result.rollback.verified,true);
    assert.equal(result.source_modified,false);
    assert.equal(read(root,'main.ts'),original);
  } finally {clean(root);}
});

test('failed verifier modifying code is not overwritten by automatic rollback', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const verifyTest=createVerifier(root, `
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync,appendFileSync } from 'node:fs';
    test('simulate independently modified source',()=>{
      const file=new URL('./src/main.ts',import.meta.url);
      if(readFileSync(file,'utf8').includes('import')) appendFileSync(file,'// independent change');
      assert.fail('verification deliberately fails');
    });
  `);
  try {
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.outcome,'blocked_external_write_or_rollback_failure');
    assert.equal(result.rollback.verified,false);
    assert.match(result.rollback.error,/independent write/);
    assert.equal(result.source_modified,true);
    assert.match(read(root,'main.ts'),/independent change/);
  } finally {clean(root);}
});

test('rejects out-of-workspace and symlink verification and invalid timeout', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'rocketLaunch();\n'});
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'pro-code-verifier-outside-'));
  try {
    fs.writeFileSync(path.join(outside,'outside.test.mjs'),"import test from 'node:test'; test('x',()=>{})");
    fs.symlinkSync(path.join(outside,'outside.test.mjs'),path.join(root,'verify.test.mjs'));
    assert.throws(()=>executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest:'verify.test.mjs'}),/non-symlink/);
    assert.throws(()=>executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest:path.join(outside,'outside.test.mjs')}),/escapes workspace/);
    assert.throws(()=>executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest:'verify.test.mjs',timeoutMs:0}),/timeout/);
  } finally {clean(root);clean(outside);}
});

test('CLI repair uses real source and test and requires explicit verifier', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const verifyTest=createVerifier(root, `
    import test from 'node:test';
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    test('import present',()=>assert.match(readFileSync(new URL('./src/main.ts',import.meta.url),'utf8'),/import/));
  `);
  const cli=fileURLToPath(new URL('./code-fix.mjs',import.meta.url));
  try {
    const base=[cli,'--root',root,'--file','src/main.ts','--code','2304'];
    const invalid=spawnSync(process.execPath,[...base,'--repair'],{encoding:'utf8'});
    assert.notEqual(invalid.status,0);
    assert.match(invalid.stderr,/requires --code and --verify-test/);
    const output=execFileSync(process.execPath,[...base,'--repair','--verify-test',verifyTest],{encoding:'utf8',timeout:60_000});
    const result=JSON.parse(output);
    assert.equal(result.outcome,'verified_code_repair');
    assert.equal(result.verification.passed,true);
    assert.match(read(root,'main.ts'),/import/);
  } finally {clean(root);}
});


test('failed guarded apply returns source-backed unchanged state with no false completion', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const before=read(root,'main.ts');
  const verifyTest=createVerifier(root, "import test from 'node:test'; test('baseline',()=>{});");
  try {
    fs.mkdirSync(path.join(root,'.pro-code'));
    fs.writeFileSync(path.join(root,'.pro-code','semantic-refactor.lock'),'existing concurrent writer');
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.outcome,'application_failed_unchanged');
    assert.equal(result.source_modified,false);
    assert.equal(result.rollback.verified,true);
    assert.match(result.application_error,/EEXIST/);
    assert.equal(read(root,'main.ts'),before);
    assert.equal(Object.hasOwn(result,'workspace'),false,'do not leak host absolute workspace path');
  } finally {clean(root);}
});

test('API requires an explicit real verifier path before attempting any source mutation', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  try {
    assert.throws(()=>executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304}),/verifyTest path/);
    assert.equal(read(root,'main.ts'),'const n = rocketLaunch();\n');
  } finally {clean(root);}
});


test('baseline acceptance script changing source blocks repair without overwriting writer', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const verifyTest=createVerifier(root,[
    "import test from 'node:test';",
    "import { appendFileSync } from 'node:fs';",
    "test('writes independently',()=>appendFileSync(new URL('./src/main.ts',import.meta.url),'// external baseline edit'));",
  ].join('\n'));
  try {
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.outcome,'baseline_verifier_modified_source');
    assert.equal(result.source_modified,true);
    assert.equal(result.baseline.passed,true);
    assert.equal(result.verification,null);
    assert.match(read(root,'main.ts'),/external baseline edit/);
    assert.doesNotMatch(read(root,'main.ts'),/import.*rocketLaunch/);
  } finally {clean(root);}
});


test('no registered Node test cannot certify repaired code', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const original=read(root,'main.ts');
  const verifyTest=createVerifier(root,'// empty acceptance suite - no node:test assertion');
  try {
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.baseline.passed,false);
    assert.equal(result.outcome,'verification_failed_restored');
    assert.equal(result.verification.passed,false);
    assert.equal(result.rollback.verified,true);
    assert.equal(read(root,'main.ts'),original);
  } finally {clean(root);}
});

test('verifier introducing unrelated compiler error cannot certify repair or hide external change', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n: number = rocketLaunch();\n'});
  const original=read(root,'main.ts');
  const verifyTest=createVerifier(root,[
    "import test from 'node:test';",
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "test('independent dependency mutation',()=>{",
    "const main=readFileSync(new URL('./src/main.ts',import.meta.url),'utf8');",
    "if (main.includes('import')) writeFileSync(new URL('./src/util.ts',import.meta.url),",
    "'export function rocketLaunch() { return \"incorrect\"; }');",
    "});",
  ].join('\n'));
  try {
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest});
    assert.equal(result.verification.passed,true,'the supplied acceptance script itself passes');
    assert.equal(result.outcome,'verification_failed_restored_with_external_changes');
    assert.equal(result.rollback.verified,true);
    assert.equal(result.source_modified,true,'unplanned dependency write must be acknowledged');
    assert.ok(result.verification.new_project_diagnostic_count>0);
    assert.deepEqual(result.unplanned_project_files,['src/util.ts']);
    assert.equal(read(root,'main.ts'),original,'only our own source edit is restored');
    assert.match(read(root,'util.ts'),/incorrect/,'do not clobber a verifier write');
  } finally {clean(root);}
});


test('supervised verifier timeout kills POSIX test process group and leaves source unmodified', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const before=read(root,'main.ts');
  const verifyTest=createVerifier(root,[
    "import test from 'node:test';",
    "import { spawn } from 'node:child_process';",
    "test('hangs with a descendant',async()=>{",
    "spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','ignore','ignore']});",
    "await new Promise(()=>{});",
    "});",
  ].join('\n'));
  try {
    const started=Date.now();
    const result=executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest,timeoutMs:1_400});
    assert.equal(result.outcome,'baseline_verifier_unavailable');
    assert.equal(result.baseline.passed,false);
    assert.equal(result.baseline.error_code,'ETIMEDOUT');
    if(process.platform!=='win32') assert.equal(result.baseline.group_termination_signaled,true);
    assert.equal(result.source_modified,false);
    assert.equal(read(root,'main.ts'),before);
    assert.ok(Date.now()-started < 9_000,'supervised verifier timeout must return promptly');
  } finally {clean(root);}
});


test('full repair lifecycle lock rejects competing operations without modifying their source', () => {
  const root=fixture({'util.ts':'export function rocketLaunch() { return 42; }\n',
    'main.ts':'const n = rocketLaunch();\n'});
  const before=read(root,'main.ts');
  const verifier=path.join(root,'verify.test.mjs');
  fs.writeFileSync(verifier,"import test from 'node:test'; test('exists',()=>{});");
  try {
    const control=path.join(root,'.pro-code');
    fs.mkdirSync(control,{recursive:true});
    fs.writeFileSync(path.join(control,'verified-repair.lock'),'another active verified repair');
    assert.throws(
      () => executeVerifiedCodeRepair({root,file:'src/main.ts',code:2304,verifyTest:'verify.test.mjs'}),
      /EEXIST/,
    );
    assert.equal(read(root,'main.ts'),before);
    assert.equal(fs.readFileSync(path.join(control,'verified-repair.lock'),'utf8'),
      'another active verified repair');
  } finally {clean(root);}
});
