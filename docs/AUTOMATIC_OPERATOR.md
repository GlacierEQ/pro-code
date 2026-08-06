# Automatic Workspace Operator

Pro-Code now performs useful local work without waiting for a button click.

## Default behavior

Running either command starts the Nexus runtime and the automatic workspace operator:

```bash
npm run dev
# or, after npm run build
npm start
```

The operator immediately inventories the configured workspace and refreshes it every five minutes. By default, the workspace is the Pro-Code repository itself.

It writes three local artifacts under `.pro-code/runtime/`:

- `workspace-manifest.json` — machine-readable file inventory, SHA-256 values, classifications, duplicate groups, evidence-oriented candidates, and change deltas;
- `workspace-report.md` — human-readable summary of the latest run;
- `automation-status.json` — current state, run count, last run, paths, and errors.

Generated runtime artifacts are ignored by Git.

## Point it at real work

```bash
PRO_CODE_WORKSPACE_DIR="$HOME/01_LEGAL_WARROOM/1FDV-23-0001009" npm run dev
```

The workspace is read recursively. The operator skips `.git`, `.pro-code`, `node_modules`, `dist`, `coverage`, `tmp`, and symbolic links.

## What it establishes

The automatic operator:

1. inventories regular files;
2. classifies common document, data, image, audio, video, archive, and code formats;
3. computes SHA-256 for files within the configured hash-size limit;
4. detects exact duplicate groups;
5. identifies likely high-value files from names and file classes;
6. compares each run with the previous manifest;
7. records added, modified, and removed paths;
8. writes the manifest, report, and status atomically.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `PRO_CODE_AUTOMATION_ENABLED` | `true` | Disable scheduled runs with `false`; manual runs remain possible through the module API. |
| `PRO_CODE_WORKSPACE_DIR` | repository root | Workspace to inventory. |
| `PRO_CODE_RUNTIME_DIR` | `<workspace>/.pro-code/runtime` | Artifact destination. |
| `PRO_CODE_AUTOMATION_INTERVAL_MS` | `300000` | Refresh interval; minimum 5000 ms. |
| `PRO_CODE_MAX_FILES` | `25000` | Maximum files processed per run. |
| `PRO_CODE_MAX_HASH_BYTES` | `268435456` | Per-file SHA-256 size limit, default 256 MiB. |

## Evidence boundary

The report ranks likely high-value files using filenames and broad file categories. That ranking is a retrieval aid only. It does not establish authenticity, admissibility, authorship, causation, or the truth of any allegation.
