import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const unix = name => name.split(path.sep).join('/');
const inside = (root, filename) => {
  const relative = path.relative(root, filename);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

/** Canonical workspace path or null; follows symlinks before exposing edit metadata. */
export function safeWorkspacePath(workspace, filename) {
  const absolute = path.resolve(workspace, filename);
  const actual = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
  if (!inside(workspace, actual)) return null;
  let ancestor = path.dirname(absolute);
  while (!fs.existsSync(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor);
  if (!inside(workspace, fs.realpathSync(ancestor))) return null;
  return unix(path.relative(workspace, actual));
}

function scopedEdit(workspace, change) {
  const file = safeWorkspacePath(workspace, change.fileName);
  if (file === null) return null;
  return {
    file,
    is_new_file: Boolean(change.isNewFile),
    text_changes: change.textChanges.map(edit => ({
      start: edit.span.start,
      length: edit.span.length,
      new_text: edit.newText,
    })),
  };
}

/** Resolve a specific compiler suggestion to documentation and complete import/edit previews. */
export function resolveCompletion({ service, workspace, file, position, entries, name, source = null }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('resolve-name must be a nonempty completion name');
  if (source !== null && typeof source !== 'string') throw new Error('resolve-source must be a string');
  const matches = entries.filter(entry => entry.name === name && (source === null || entry.source === source));
  if (!matches.length) throw new Error(`Completion ${JSON.stringify(name)} is not available at this cursor`);
  if (matches.length > 1) throw new Error(`Completion ${JSON.stringify(name)} is ambiguous; specify --resolve-source`);
  const selected = matches[0];
  const detail = service.getCompletionEntryDetails(
    file, position, selected.name,
    { indentSize: 2, tabSize: 2, newLineCharacter: '\n' },
    selected.source, { includeCompletionsForModuleExports: true, includeCompletionsWithInsertText: true },
    selected.data,
  );
  if (!detail) throw new Error(`Compiler could not resolve completion ${JSON.stringify(name)}`);
  return {
    name: selected.name,
    source: selected.source ?? null,
    kind: detail.kind,
    display: ts.displayPartsToString(detail.displayParts ?? []),
    documentation: ts.displayPartsToString(detail.documentation ?? []),
    tags: (detail.tags ?? []).map(tag => ({ name: tag.name, text: ts.displayPartsToString(tag.text ?? []) })),
    code_actions: (detail.codeActions ?? []).map(action => {
      const changes = (action.changes ?? []).map(change => scopedEdit(workspace, change));
      const withinWorkspace = changes.every(Boolean);
      const requiresCommands = Boolean(action.commands?.length);
      return {
        description: action.description,
        within_workspace: withinWorkspace,
        requires_commands: requiresCommands,
        // Never disclose or claim executable edits to files outside the selected workspace.
        changes: withinWorkspace ? changes : [],
      };
    }),
  };
}
