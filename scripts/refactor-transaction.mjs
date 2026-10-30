import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const digest = data => createHash('sha256').update(data).digest('hex');
function contained(root, name) {
  const resolved = path.resolve(root, name);
  const rel = path.relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error(`refactor file escapes workspace: ${name}`);
  const real = fs.realpathSync(resolved);
  const canonical = path.relative(root, real);
  if (canonical === '..' || canonical.startsWith(`..${path.sep}`) || path.isAbsolute(canonical) || !fs.statSync(real).isFile())
    throw new Error(`refactor file is outside workspace or not regular: ${name}`);
  return real;
}

/** Commit prepared semantic edits with a cooperating-process lock, all-file preflight,
 *  atomic individual renames, digest readback, and non-clobbering exception recovery.
 *  Process termination is not a multi-file transaction: keep changes in version control.
 */
export function commitGuardedFiles({ root, files, beforeWrite } = {}) {
  if (!Array.isArray(files) || files.length === 0) throw new Error('refactor files are required');
  const workspace = fs.realpathSync(root);
  const control = path.join(workspace, '.pro-code');
  fs.mkdirSync(control, { recursive: true });
  const controlInfo = fs.lstatSync(control);
  if (controlInfo.isSymbolicLink() || !controlInfo.isDirectory()) throw new Error('refactor control directory must be a real workspace directory');
  const lockPath = path.join(control, 'semantic-refactor.lock');
  const lockFd = fs.openSync(lockPath, 'wx', 0o600);
  const staged = [];
  const committed = [];
  try {
    const seen = new Set();
    const prepared = files.map(file => {
      const absolute = contained(workspace, file.relative);
      if (seen.has(absolute)) throw new Error('duplicate refactor target');
      seen.add(absolute);
      const original = fs.readFileSync(absolute, 'utf8');
      if (digest(original) !== digest(file.original) || original !== file.original)
        throw new Error(`source changed after preview: ${file.relative}`);
      if (typeof file.content !== 'string' || digest(file.content) !== file.expectedAfter)
        throw new Error(`planned content digest mismatch: ${file.relative}`);
      return { ...file, absolute, original, expectedBefore: digest(original) };
    });
    // All new files are staged before the first original is replaced.
    for (const item of prepared) {
      const tmp = path.join(path.dirname(item.absolute), `.pro-code-refactor-${randomUUID()}.tmp`);
      fs.writeFileSync(tmp, item.content, { flag: 'wx', mode: fs.statSync(item.absolute).mode & 0o777 });
      staged.push(tmp);
      if (digest(fs.readFileSync(tmp, 'utf8')) !== item.expectedAfter)
        throw new Error(`staged digest mismatch: ${item.relative}`);
    }
    for (let index = 0; index < prepared.length; index++) {
      const item = prepared[index];
      if (beforeWrite) beforeWrite(item.relative, index);
      if (digest(fs.readFileSync(item.absolute, 'utf8')) !== item.expectedBefore)
        throw new Error(`concurrent source mutation: ${item.relative}`);
      fs.renameSync(staged[index], item.absolute);
      committed.push(item);
      if (digest(fs.readFileSync(item.absolute, 'utf8')) !== item.expectedAfter)
        throw new Error(`readback mismatch: ${item.relative}`);
    }
    return { verified: true, changed: prepared.length };
  } catch (error) {
    const rollbackErrors = [];
    for (const item of committed.reverse()) {
      try {
        // Never overwrite an independent writer that modified a file after our commit.
        if (digest(fs.readFileSync(item.absolute, 'utf8')) !== item.expectedAfter) {
          rollbackErrors.push(`${item.relative}: altered by another writer; preserved`);
          continue;
        }
        const tmp = path.join(path.dirname(item.absolute), `.pro-code-restore-${randomUUID()}.tmp`);
        fs.writeFileSync(tmp, item.original, { flag: 'wx', mode: fs.statSync(item.absolute).mode & 0o777 });
        try { fs.renameSync(tmp, item.absolute); }
        finally { try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== 'ENOENT') throw err; } }
      } catch (failure) { rollbackErrors.push(`${item.relative}: ${String(failure)}`); }
    }
    throw new Error(`rename failed: ${error instanceof Error ? error.message : String(error)}; rollback_errors=${JSON.stringify(rollbackErrors)}`);
  } finally {
    for (const tmp of staged) {
      try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    fs.closeSync(lockFd);
    fs.unlinkSync(lockPath);
  }
}