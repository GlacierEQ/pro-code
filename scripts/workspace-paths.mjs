import { lstat, mkdir } from 'node:fs/promises';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

export function canonicalWorkspace(root) {
  const workspace = realpathSync(path.resolve(root));
  if (!statSync(workspace).isDirectory()) throw new Error('workspace root must be a directory');
  return workspace;
}

export function canonicalFile(workspace, requested, label) {
  const input = path.resolve(workspace, requested);
  if (!within(workspace, input)) throw new Error(label + ' must remain inside the workspace');
  const actual = realpathSync(input);
  if (!within(workspace, actual)) throw new Error(label + ' resolves outside the workspace');
  if (!statSync(actual).isFile()) throw new Error(label + ' must be a regular file');
  return actual;
}

/** Prepare a report destination while refusing symlinked directories or files.
 * No implicit file writes or directory creation outside the canonical workspace.
 */
export async function prepareWorkspaceOutput(workspace, requested) {
  const output = path.resolve(workspace, requested);
  if (output === workspace || !within(workspace, output)) {
    throw new Error('Output path must stay inside workspace');
  }
  const directories = path.relative(workspace, path.dirname(output)).split(path.sep).filter(Boolean);
  let parent = workspace;
  for (const segment of directories) {
    parent = path.join(parent, segment);
    try {
      const entry = await lstat(parent);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error('Output directory must be a real directory inside workspace');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(parent);
    }
  }
  try {
    const entry = await lstat(output);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('Output destination must be a regular file inside workspace');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return output;
}
