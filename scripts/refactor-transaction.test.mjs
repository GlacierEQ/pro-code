import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { commitGuardedFiles } from './refactor-transaction.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor-transaction-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root,'src/a.ts'),'alpha');
  fs.writeFileSync(path.join(root,'src/b.ts'),'beta');
  return root;
}
const change = (relative, original, content) => ({relative,original,content,expectedAfter:hash(content)});
const plan = () => [change('src/a.ts','alpha','new-alpha'),change('src/b.ts','beta','new-beta')];
const clean = root => fs.rmSync(root,{recursive:true,force:true});

test('commits all files with digest readback and removes lock', () => {
 const root=fixture();try{
  const result=commitGuardedFiles({root,files:plan()});
  assert.deepEqual(result,{verified:true,changed:2});
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'new-alpha');
  assert.equal(fs.readFileSync(path.join(root,'src/b.ts'),'utf8'),'new-beta');
  assert.ok(!fs.existsSync(path.join(root,'.pro-code/semantic-refactor.lock')));
 }finally{clean(root);}
});

test('detects stale preview before modifying any file',()=>{
 const root=fixture();try{
  fs.writeFileSync(path.join(root,'src/b.ts'),'external');
  assert.throws(()=>commitGuardedFiles({root,files:plan()}),/source changed after preview/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'alpha');
  assert.equal(fs.readFileSync(path.join(root,'src/b.ts'),'utf8'),'external');
 }finally{clean(root);}
});

test('rollback restores first committed file if a later write fails',()=>{
 const root=fixture();try{
  assert.throws(()=>commitGuardedFiles({root,files:plan(),beforeWrite:(_name,index)=>{if(index===1)throw Error('injected');}}),/injected; rollback_errors=\[\]/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'alpha');
  assert.equal(fs.readFileSync(path.join(root,'src/b.ts'),'utf8'),'beta');
 }finally{clean(root);}
});

test('rollback preserves externally modified committed files instead of overwriting them',()=>{
 const root=fixture();try{
  assert.throws(()=>commitGuardedFiles({root,files:plan(),beforeWrite:(_name,index)=>{
   if(index===1){fs.writeFileSync(path.join(root,'src/a.ts'),'external-after-commit');throw Error('injected');}
  }}),/altered by another writer; preserved/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'external-after-commit');
  assert.equal(fs.readFileSync(path.join(root,'src/b.ts'),'utf8'),'beta');
 }finally{clean(root);}
});

test('lock prevents concurrent cooperating process from writing',()=>{
 const root=fixture();try{
  fs.mkdirSync(path.join(root,'.pro-code'));
  fs.writeFileSync(path.join(root,'.pro-code/semantic-refactor.lock'),'held');
  assert.throws(()=>commitGuardedFiles({root,files:plan()}),/EEXIST/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'alpha');
 }finally{clean(root);}
});

test('rejects duplicate file targets without mutation',()=>{
 const root=fixture();try{
  assert.throws(()=>commitGuardedFiles({root,files:[plan()[0],plan()[0]]}),/duplicate refactor target/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'alpha');
 }finally{clean(root);}
});

test('rejects out-of-scope paths and symlinks',()=>{
 const root=fixture();const external=fs.mkdtempSync(path.join(os.tmpdir(),'refactor-outside-'));
 try{
  fs.writeFileSync(path.join(external,'data.ts'),'secret');
  fs.symlinkSync(path.join(external,'data.ts'),path.join(root,'src/link.ts'));
  assert.throws(()=>commitGuardedFiles({root,files:[change('../data.ts','secret','new')]}),/escapes workspace/);
  assert.throws(()=>commitGuardedFiles({root,files:[change('src/link.ts','secret','new')]}),/outside workspace/);
  assert.equal(fs.readFileSync(path.join(external,'data.ts'),'utf8'),'secret');
 }finally{clean(root);clean(external);}
});

test('rejects tampered planned bytes before mutation',()=>{
 const root=fixture();try{
  assert.throws(()=>commitGuardedFiles({root,files:[{...plan()[0],content:'different'}]}),/planned content digest mismatch/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'alpha');
 }finally{clean(root);}
});

test('prewrite mutation is detected and earlier commit rolled back',()=>{
 const root=fixture();try{
  assert.throws(()=>commitGuardedFiles({root,files:plan(),beforeWrite:(name,index)=>{
   if(index===1)fs.writeFileSync(path.join(root,name),'racing edit');
  }}),/concurrent source mutation/);
  assert.equal(fs.readFileSync(path.join(root,'src/a.ts'),'utf8'),'alpha');
  assert.equal(fs.readFileSync(path.join(root,'src/b.ts'),'utf8'),'racing edit');
 }finally{clean(root);}
});