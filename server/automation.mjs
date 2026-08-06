import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED = new Set(['.git', '.pro-code', 'coverage', 'dist', 'node_modules', 'tmp']);
const EXTENSIONS = Object.freeze({
  archive: '7z gz rar tar zip',
  data: 'csv db json parquet sqlite sql tsv xml yaml yml',
  document: 'doc docx html md odt pdf rtf txt',
  audio: 'aac flac m4a mp3 ogg wav',
  video: 'avi m4v mkv mov mp4 webm',
  image: 'gif heic jpeg jpg png svg tif tiff webp',
  code: 'bash c cpp css go h hs java js jsx mjs php py rb rs sh ts tsx',
});
const CATEGORY = new Map(Object.entries(EXTENSIONS).flatMap(([category, values]) =>
  values.split(' ').map(extension => [`.${extension}`, category]),
));
const EVIDENCE_TERMS = Object.freeze([
  ['docket', 10], ['order', 9], ['exhibit', 9], ['motion', 8], ['transcript', 8],
  ['hearing', 8], ['declaration', 8], ['affidavit', 8], ['recording', 7], ['audio', 7],
  ['video', 7], ['evidence', 7], ['service', 6], ['notice', 6], ['receipt', 6],
  ['police', 6], ['medical', 6], ['school', 5], ['email', 5], ['message', 5],
  ['timeline', 5], ['minutes', 5], ['judgment', 5], ['decree', 5], ['complaint', 5],
]);
const ACTIVE_CAPABILITIES = new Set([
  'analyzeCase', 'consolidateCases', 'crawlDatabase', 'pageSync', 'dataIngestionSync',
  'generateReport', 'runApexMaximize', 'helixAutomation', 'automationDispatch',
  'modelMaximize', 'organizeMemory', 'extractMemory', 'memorySync',
]);

function positiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function classify(filePath) {
  return CATEGORY.get(path.extname(filePath).toLowerCase()) ?? 'other';
}

function rank(relativePath, category) {
  const normalized = relativePath.toLowerCase();
  let score = ['audio', 'video'].includes(category) ? 3 : category === 'document' ? 2 : 0;
  const reasons = [];
  for (const [term, weight] of EVIDENCE_TERMS) {
    if (normalized.includes(term)) {
      score += weight;
      reasons.push(term);
    }
  }
  return { score, reasons };
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('end', resolve);
    stream.once('error', error => {
      stream.destroy();
      reject(error);
    });
  });
  return hash.digest('hex');
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  try {
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function delta(previous, files) {
  const before = new Map(Array.isArray(previous?.files) ? previous.files.map(file => [file.path, file]) : []);
  const current = new Set(files.map(file => file.path));
  const changes = { added: [], modified: [], removed: [] };
  for (const file of files) {
    const prior = before.get(file.path);
    if (!prior) changes.added.push(file.path);
    else if (file.sha256 && prior.sha256
      ? file.sha256 !== prior.sha256
      : file.size !== prior.size || file.modified_at !== prior.modified_at) {
      changes.modified.push(file.path);
    }
  }
  for (const priorPath of before.keys()) if (!current.has(priorPath)) changes.removed.push(priorPath);
  return changes;
}

function duplicates(files) {
  const grouped = new Map();
  for (const file of files) {
    if (!file.sha256) continue;
    const key = `${file.sha256}:${file.size}`;
    grouped.set(key, [...(grouped.get(key) ?? []), file.path]);
  }
  return [...grouped.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([key, paths]) => ({
      sha256: key.slice(0, 64),
      size: Number(key.slice(65)),
      copies: paths.length,
      paths: paths.sort(),
    }))
    .sort((a, b) => b.copies - a.copies || a.paths[0].localeCompare(b.paths[0]));
}

function report(manifest) {
  const { summary, changes } = manifest;
  const lines = [
    '# Pro-Code Automatic Workspace Report', '',
    `Generated: ${manifest.generated_at}`,
    `Workspace: \`${manifest.workspace_root}\``,
    `Manifest ID: \`${manifest.manifest_id}\``, '',
    '## Summary', '',
    `- Files indexed: **${summary.file_count}**`,
    `- Total bytes: **${summary.total_bytes}**`,
    `- Files hashed: **${summary.hashed_files}**`,
    `- Hashes skipped or failed: **${summary.hash_skipped_files}**`,
    `- Duplicate groups: **${summary.duplicate_groups}**`,
    `- High-value candidates: **${summary.high_value_candidates}**`, '',
    '## Change Delta', '',
    `- Added: **${changes.added.length}**`,
    `- Modified: **${changes.modified.length}**`,
    `- Removed: **${changes.removed.length}**`, '',
    '## File Categories', '',
    ...Object.entries(summary.by_category).sort().map(([name, count]) => `- ${name}: **${count}**`),
    '', '## Highest-Value Candidates', '',
  ];
  if (!manifest.high_value_candidates.length) lines.push('No evidence-oriented candidates were identified.');
  for (const item of manifest.high_value_candidates.slice(0, 30)) {
    lines.push(`- **${item.score}** \`${item.path}\`${item.reasons.length ? ` — ${item.reasons.join(', ')}` : ''}`);
  }
  lines.push('', '## Duplicate Groups', '');
  if (!manifest.duplicates.length) lines.push('No exact SHA-256 duplicate groups were found.');
  for (const group of manifest.duplicates.slice(0, 20)) {
    lines.push(`- ${group.copies} copies, ${group.size} bytes, SHA-256 \`${group.sha256}\``);
    for (const duplicatePath of group.paths) lines.push(`  - \`${duplicatePath}\``);
  }
  lines.push('', '## Important Boundary', '',
    'Candidate ranking is heuristic. It does not establish authenticity, admissibility, or the truth of any allegation.', '');
  return lines.join('\n');
}

export class WorkspaceAutomation {
  constructor({ workspaceRoot = process.cwd(), outputDir, env = process.env, now = () => new Date() } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.outputDir = path.resolve(outputDir ?? env.PRO_CODE_RUNTIME_DIR ?? path.join(this.workspaceRoot, '.pro-code', 'runtime'));
    this.manifestPath = path.join(this.outputDir, 'workspace-manifest.json');
    this.reportPath = path.join(this.outputDir, 'workspace-report.md');
    this.statusPath = path.join(this.outputDir, 'automation-status.json');
    this.enabled = String(env.PRO_CODE_AUTOMATION_ENABLED ?? 'true').toLowerCase() !== 'false';
    this.intervalMs = positiveInteger(env.PRO_CODE_AUTOMATION_INTERVAL_MS, 300_000, 5_000, 86_400_000);
    this.maxFiles = positiveInteger(env.PRO_CODE_MAX_FILES, 25_000, 1, 1_000_000);
    this.maxHashBytes = positiveInteger(env.PRO_CODE_MAX_HASH_BYTES, 268_435_456, 1, 10_737_418_240);
    this.now = now;
    this.timer = null;
    this.inFlight = null;
    this.status = {
      enabled: this.enabled,
      state: this.enabled ? 'idle' : 'disabled',
      workspace_root: this.workspaceRoot,
      output_dir: this.outputDir,
      interval_ms: this.intervalMs,
      run_count: 0,
      last_run: null,
      latest: null,
      last_error: null,
    };
  }

  getStatus() {
    return structuredClone(this.status);
  }

  start() {
    if (!this.enabled || this.timer) return;
    void this.run('startup');
    this.timer = setInterval(() => void this.run('interval'), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async run(reason = 'manual') {
    if (!this.enabled && reason !== 'manual') return this.getStatus();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runInternal(reason).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async executeCapability(capability, params = {}) {
    if (!ACTIVE_CAPABILITIES.has(capability)) return { handled: false, summary: this.status.latest };
    const status = await this.run(`capability:${capability}`);
    return {
      handled: true,
      summary: status.latest,
      artifacts: { manifest: this.manifestPath, report: this.reportPath, status: this.statusPath },
      parameters_received: Object.keys(params).length,
    };
  }

  async runInternal(reason) {
    const startedAt = this.now();
    this.status = { ...this.status, state: 'running', last_error: null, current_reason: reason };
    await this.persistStatus();
    try {
      const previous = await readJson(this.manifestPath);
      const files = await this.scanFiles();
      const byCategory = {};
      let totalBytes = 0;
      let hashedFiles = 0;
      for (const file of files) {
        byCategory[file.category] = (byCategory[file.category] ?? 0) + 1;
        totalBytes += file.size;
        if (file.sha256) hashedFiles += 1;
      }
      const exactDuplicates = duplicates(files);
      const candidates = files
        .filter(file => file.evidence.score > 0)
        .map(file => ({ path: file.path, category: file.category, size: file.size, sha256: file.sha256, ...file.evidence }))
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      const changes = delta(previous, files);
      const generatedAt = this.now().toISOString();
      const manifestId = createHash('sha256').update(JSON.stringify({
        workspace_root: this.workspaceRoot,
        generated_at: generatedAt,
        files: files.map(file => ({ path: file.path, size: file.size, sha256: file.sha256 })),
      })).digest('hex');
      const manifest = {
        schema_version: '1.0.0', manifest_id: manifestId, generated_at: generatedAt, reason,
        workspace_root: this.workspaceRoot, output_dir: this.outputDir,
        summary: {
          file_count: files.length, total_bytes: totalBytes, hashed_files: hashedFiles,
          hash_skipped_files: files.length - hashedFiles, duplicate_groups: exactDuplicates.length,
          high_value_candidates: candidates.length, by_category: byCategory,
        },
        changes, high_value_candidates: candidates, duplicates: exactDuplicates, files,
      };
      await atomicWrite(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await atomicWrite(this.reportPath, report(manifest));
      const completedAt = this.now();
      this.status = {
        ...this.status,
        state: 'idle',
        run_count: this.status.run_count + 1,
        last_run: {
          reason,
          started_at: startedAt.toISOString(),
          completed_at: completedAt.toISOString(),
          duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        },
        latest: {
          manifest_id: manifestId,
          file_count: files.length,
          total_bytes: totalBytes,
          duplicate_groups: exactDuplicates.length,
          high_value_candidates: candidates.length,
          changes: Object.fromEntries(Object.entries(changes).map(([name, paths]) => [name, paths.length])),
          manifest_path: this.manifestPath,
          report_path: this.reportPath,
        },
        last_error: null,
      };
      delete this.status.current_reason;
      await this.persistStatus();
      return this.getStatus();
    } catch (error) {
      this.status = { ...this.status, state: 'error', last_error: error instanceof Error ? error.message : String(error) };
      delete this.status.current_reason;
      await this.persistStatus().catch(() => {});
      throw error;
    }
  }

  async scanFiles() {
    const files = [];
    const pending = [this.workspaceRoot];
    while (pending.length) {
      const directory = pending.pop();
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (files.length >= this.maxFiles) return files.sort((a, b) => a.path.localeCompare(b.path));
        if (EXCLUDED.has(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        if (absolutePath === this.outputDir || absolutePath.startsWith(`${this.outputDir}${path.sep}`)) continue;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          pending.push(absolutePath);
          continue;
        }
        if (!entry.isFile()) continue;
        let metadata;
        try {
          metadata = await stat(absolutePath);
        } catch {
          continue;
        }
        const relativePath = path.relative(this.workspaceRoot, absolutePath).split(path.sep).join('/');
        const category = classify(relativePath);
        let fileHash = null;
        let hashStatus = metadata.size > this.maxHashBytes ? 'skipped_size_limit' : 'hashed';
        if (hashStatus === 'hashed') {
          try {
            fileHash = await sha256(absolutePath);
          } catch {
            hashStatus = 'failed';
          }
        }
        files.push({
          path: relativePath,
          category,
          size: metadata.size,
          modified_at: metadata.mtime.toISOString(),
          sha256: fileHash,
          hash_status: hashStatus,
          evidence: rank(relativePath, category),
        });
      }
    }
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async persistStatus() {
    await atomicWrite(this.statusPath, `${JSON.stringify(this.status, null, 2)}\n`);
  }
}
