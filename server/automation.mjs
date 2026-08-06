import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_EXCLUDED_NAMES = new Set([
  '.git',
  '.pro-code',
  'coverage',
  'dist',
  'node_modules',
  'tmp',
]);

const CATEGORY_BY_EXTENSION = Object.freeze({
  '.7z': 'archive', '.gz': 'archive', '.rar': 'archive', '.tar': 'archive', '.zip': 'archive',
  '.csv': 'data', '.db': 'data', '.json': 'data', '.parquet': 'data', '.sqlite': 'data', '.sql': 'data', '.tsv': 'data', '.xml': 'data', '.yaml': 'data', '.yml': 'data',
  '.doc': 'document', '.docx': 'document', '.html': 'document', '.md': 'document', '.odt': 'document', '.pdf': 'document', '.rtf': 'document', '.txt': 'document',
  '.aac': 'audio', '.flac': 'audio', '.m4a': 'audio', '.mp3': 'audio', '.ogg': 'audio', '.wav': 'audio',
  '.avi': 'video', '.m4v': 'video', '.mkv': 'video', '.mov': 'video', '.mp4': 'video', '.webm': 'video',
  '.gif': 'image', '.heic': 'image', '.jpeg': 'image', '.jpg': 'image', '.png': 'image', '.svg': 'image', '.tif': 'image', '.tiff': 'image', '.webp': 'image',
  '.bash': 'code', '.c': 'code', '.cpp': 'code', '.css': 'code', '.go': 'code', '.h': 'code', '.hs': 'code', '.java': 'code', '.js': 'code', '.jsx': 'code', '.mjs': 'code', '.php': 'code', '.py': 'code', '.rb': 'code', '.rs': 'code', '.sh': 'code', '.ts': 'code', '.tsx': 'code',
});

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

function positiveInteger(value, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(parsed)));
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function classifyFile(filePath) {
  return CATEGORY_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'other';
}

function evidenceScore(relativePath, category) {
  const normalized = relativePath.toLowerCase();
  let score = category === 'audio' || category === 'video' ? 3 : category === 'document' ? 2 : 0;
  const reasons = [];
  for (const [term, weight] of EVIDENCE_TERMS) {
    if (normalized.includes(term)) {
      score += weight;
      reasons.push(term);
    }
  }
  return { score, reasons };
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function readJsonIfPresent(filePath) {
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
  await rename(temporary, filePath);
}

function compareManifests(previous, currentFiles) {
  const priorByPath = new Map(
    Array.isArray(previous?.files) ? previous.files.map(file => [file.path, file]) : [],
  );
  const currentByPath = new Map(currentFiles.map(file => [file.path, file]));
  const added = [];
  const modified = [];
  const removed = [];

  for (const file of currentFiles) {
    const prior = priorByPath.get(file.path);
    if (!prior) {
      added.push(file.path);
      continue;
    }
    const hashChanged = file.sha256 && prior.sha256
      ? file.sha256 !== prior.sha256
      : file.size !== prior.size || file.modified_at !== prior.modified_at;
    if (hashChanged) modified.push(file.path);
  }

  for (const priorPath of priorByPath.keys()) {
    if (!currentByPath.has(priorPath)) removed.push(priorPath);
  }

  return { added, modified, removed };
}

function duplicateGroups(files) {
  const groups = new Map();
  for (const file of files) {
    if (!file.sha256) continue;
    const key = `${file.sha256}:${file.size}`;
    const group = groups.get(key) ?? [];
    group.push(file.path);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([key, paths]) => ({
      sha256: key.slice(0, 64),
      size: Number(key.slice(65)),
      copies: paths.length,
      paths: paths.sort(),
    }))
    .sort((left, right) => right.copies - left.copies || left.paths[0].localeCompare(right.paths[0]));
}

function renderReport(manifest) {
  const lines = [
    '# Pro-Code Automatic Workspace Report',
    '',
    `Generated: ${manifest.generated_at}`,
    `Workspace: \`${manifest.workspace_root}\``,
    `Manifest ID: \`${manifest.manifest_id}\``,
    '',
    '## Summary',
    '',
    `- Files indexed: **${manifest.summary.file_count}**`,
    `- Total bytes: **${manifest.summary.total_bytes}**`,
    `- Files hashed: **${manifest.summary.hashed_files}**`,
    `- Hashes skipped by size limit: **${manifest.summary.hash_skipped_files}**`,
    `- Duplicate groups: **${manifest.summary.duplicate_groups}**`,
    `- High-value candidates: **${manifest.summary.high_value_candidates}**`,
    '',
    '## Change Delta',
    '',
    `- Added: **${manifest.changes.added.length}**`,
    `- Modified: **${manifest.changes.modified.length}**`,
    `- Removed: **${manifest.changes.removed.length}**`,
    '',
    '## File Categories',
    '',
  ];

  for (const [category, count] of Object.entries(manifest.summary.by_category).sort()) {
    lines.push(`- ${category}: **${count}**`);
  }

  lines.push('', '## Highest-Value Candidates', '');
  if (manifest.high_value_candidates.length === 0) {
    lines.push('No evidence-oriented candidates were identified by filename and type heuristics.');
  } else {
    for (const candidate of manifest.high_value_candidates.slice(0, 30)) {
      const reasons = candidate.reasons.length ? ` — ${candidate.reasons.join(', ')}` : '';
      lines.push(`- **${candidate.score}** \`${candidate.path}\`${reasons}`);
    }
  }

  lines.push('', '## Duplicate Groups', '');
  if (manifest.duplicates.length === 0) {
    lines.push('No exact SHA-256 duplicate groups were found.');
  } else {
    for (const group of manifest.duplicates.slice(0, 20)) {
      lines.push(`- ${group.copies} copies, ${group.size} bytes, SHA-256 \`${group.sha256}\``);
      for (const duplicatePath of group.paths) lines.push(`  - \`${duplicatePath}\``);
    }
  }

  lines.push('', '## Important Boundary', '');
  lines.push('Candidate ranking is heuristic. It identifies likely high-value files for review; it does not establish authenticity, admissibility, or the truth of any allegation.');
  return `${lines.join('\n')}\n`;
}

export class WorkspaceAutomation {
  constructor({
    workspaceRoot = process.cwd(),
    outputDir,
    env = process.env,
    now = () => new Date(),
  } = {}) {
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
    this.inFlight = this.runInternal(reason).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  async executeCapability(capability, params = {}) {
    if (!ACTIVE_CAPABILITIES.has(capability)) {
      return {
        handled: false,
        summary: this.status.latest,
      };
    }
    const status = await this.run(`capability:${capability}`);
    return {
      handled: true,
      summary: status.latest,
      artifacts: {
        manifest: this.manifestPath,
        report: this.reportPath,
        status: this.statusPath,
      },
      parameters_received: Object.keys(params).length,
    };
  }

  async runInternal(reason) {
    const startedAt = this.now();
    this.status = {
      ...this.status,
      state: 'running',
      last_error: null,
      current_reason: reason,
    };
    await this.persistStatus();

    try {
      const previous = await readJsonIfPresent(this.manifestPath);
      const files = await this.scanFiles();
      const categories = {};
      let totalBytes = 0;
      let hashedFiles = 0;
      let hashSkippedFiles = 0;
      for (const file of files) {
        categories[file.category] = (categories[file.category] ?? 0) + 1;
        totalBytes += file.size;
        if (file.sha256) hashedFiles += 1;
        else hashSkippedFiles += 1;
      }

      const duplicates = duplicateGroups(files);
      const candidates = files
        .filter(file => file.evidence.score > 0)
        .map(file => ({
          path: file.path,
          category: file.category,
          score: file.evidence.score,
          reasons: file.evidence.reasons,
          size: file.size,
          sha256: file.sha256,
        }))
        .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
      const changes = compareManifests(previous, files);
      const generatedAt = this.now().toISOString();
      const manifestSeed = {
        workspace_root: this.workspaceRoot,
        generated_at: generatedAt,
        files: files.map(file => ({ path: file.path, size: file.size, sha256: file.sha256 })),
      };
      const manifest = {
        schema_version: '1.0.0',
        manifest_id: createHash('sha256').update(JSON.stringify(manifestSeed)).digest('hex'),
        generated_at: generatedAt,
        reason,
        workspace_root: this.workspaceRoot,
        output_dir: this.outputDir,
        summary: {
          file_count: files.length,
          total_bytes: totalBytes,
          hashed_files: hashedFiles,
          hash_skipped_files: hashSkippedFiles,
          duplicate_groups: duplicates.length,
          high_value_candidates: candidates.length,
          by_category: categories,
        },
        changes,
        high_value_candidates: candidates,
        duplicates,
        files,
      };

      await atomicWrite(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await atomicWrite(this.reportPath, renderReport(manifest));
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
          manifest_id: manifest.manifest_id,
          file_count: manifest.summary.file_count,
          total_bytes: manifest.summary.total_bytes,
          duplicate_groups: manifest.summary.duplicate_groups,
          high_value_candidates: manifest.summary.high_value_candidates,
          changes: {
            added: changes.added.length,
            modified: changes.modified.length,
            removed: changes.removed.length,
          },
          manifest_path: this.manifestPath,
          report_path: this.reportPath,
        },
        last_error: null,
      };
      delete this.status.current_reason;
      await this.persistStatus();
      return this.getStatus();
    } catch (error) {
      this.status = {
        ...this.status,
        state: 'error',
        last_error: error instanceof Error ? error.message : String(error),
      };
      delete this.status.current_reason;
      await this.persistStatus().catch(() => {});
      throw error;
    }
  }

  async scanFiles() {
    const files = [];
    const pending = [this.workspaceRoot];

    while (pending.length > 0) {
      const directory = pending.pop();
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        if (files.length >= this.maxFiles) return files;
        if (DEFAULT_EXCLUDED_NAMES.has(entry.name)) continue;
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
        const relativePath = normalizeRelativePath(path.relative(this.workspaceRoot, absolutePath));
        const category = classifyFile(relativePath);
        const evidence = evidenceScore(relativePath, category);
        let sha256 = null;
        let hash_status = 'hashed';
        if (metadata.size > this.maxHashBytes) {
          hash_status = 'skipped_size_limit';
        } else {
          try {
            sha256 = await hashFile(absolutePath);
          } catch {
            hash_status = 'failed';
          }
        }
        files.push({
          path: relativePath,
          category,
          size: metadata.size,
          modified_at: metadata.mtime.toISOString(),
          sha256,
          hash_status,
          evidence,
        });
      }
    }

    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async persistStatus() {
    await atomicWrite(this.statusPath, `${JSON.stringify(this.status, null, 2)}\n`);
  }
}
