# Pro-Code — Governed Local Engineering Operator

> A React/TypeScript operator surface backed by a dependency-free local Nexus runtime, fail-closed worker dispatch, automatic workspace intelligence, and native polyglot verification.

[![Pro-Code native verification](https://github.com/GlacierEQ/pro-code/actions/workflows/ci.yml/badge.svg)](https://github.com/GlacierEQ/pro-code/actions/workflows/ci.yml)

**Version:** `0.2.0`  
**Canonical repository:** `GlacierEQ/pro-code`  
**Canonical branch:** `main`  
**Current posture:** `LOCAL_OPERABLE`  
**Current evidence:** `TEST`

Pro-Code is the public executable strand of the GlacierEQ engineering doctrine. It is now a runnable local system rather than only a frontend contract: the repository owns a local Nexus HTTP runtime, a governed dispatch envelope, idempotent receipts, an automatic workspace-inventory operator, optional explicitly configured filesystem synchronization, the React operator UI, and native Rust/Haskell policy checks.

It does **not** claim a production worker fleet, external provider authorization, live remote Mastermind/APEX mesh connectivity, or permission to execute external actions.

## Recruiter view

### What works now

Running the repository locally can provide three useful layers together:

1. **Operator surface** — React/Vite UI for selecting capabilities, case context, worker state, and dispatch.
2. **Governed local runtime** — Node Nexus server validates worker ownership, case/trace/task/idempotency identity, bounded constraints, and explicit acknowledgement before reporting success.
3. **Automatic workspace intelligence** — bounded recursive inventory produces SHA-256 hashes where eligible, exact duplicate groups, file/change deltas, category summaries, and heuristic evidence-oriented candidate ranking.

The system also preserves native language boundaries:

- Rust for a bounded call-depth governor;
- Haskell for pure AST validity invariants;
- Python for repository-level checks;
- TypeScript/React for operator and dispatch contracts.

### Fast proof path

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build

python -m unittest discover -s tests -p 'test_*.py' -v

rustc --edition 2021 --test src/governor.rs -o /tmp/pro-code-governor-tests
/tmp/pro-code-governor-tests

ghc -Wall -Werror -isrc tests/ASTValidatorSpec.hs -o /tmp/pro-code-ast-tests
/tmp/pro-code-ast-tests
```

At canonical head `c1fbf3f3d28f596d28903fa2f8a91c7fbaecb6af`, both the repository's native verification workflow and Helix Verify completed successfully on `main`. A future source change must earn a fresh receipt; this README does not make those historical runs permanently authoritative for later heads.

## Engineering anatomy

### 1. Local Nexus runtime

[`server/nexus.mjs`](server/nexus.mjs) owns the local HTTP boundary.

It currently provides:

- `/health` with the declared worker registry and automation state;
- governed worker dispatch using the existing case-scoped envelope contract;
- worker/capability ownership validation;
- matching `X-Case-Id`, `X-Trace-Id`, and `Idempotency-Key` guards;
- bounded request bodies and explicit constraints;
- in-memory idempotent receipts and conflicting-key rejection;
- session-context storage;
- optional filesystem memory snapshots only when a target directory is explicitly configured;
- static serving of the built `dist` application;
- automatic-operator status/run endpoints when automation is attached.

```text
operator / client
      │
      ▼
local Nexus HTTP runtime
      │
      ├── reject malformed / unknown / mismatched dispatch
      │
      ├── preserve idempotency + receipt identity
      │
      ├── invoke a registered local automation handler when available
      │
      └── otherwise acknowledge bounded local acceptance only
```

A worker registry entry is still not an external deployed worker. When no local automation handler owns a capability, the runtime records that boundary rather than inventing remote execution.

### 2. Automatic workspace operator

[`server/automation.mjs`](server/automation.mjs) performs bounded local workspace analysis. `npm run dev`, `npm run runtime`, and `npm start` use the automatic runtime path.

The operator can:

- recursively inventory the configured workspace;
- exclude `.git`, `.pro-code`, `node_modules`, `dist`, `coverage`, `tmp`, and symbolic-link noise;
- classify common document/data/media/archive/code file types;
- hash eligible files with SHA-256 under configurable size limits;
- detect exact duplicate groups;
- compare a new inventory with the prior manifest and record added/modified/removed paths;
- rank likely evidence-oriented candidates using explicit filename/category heuristics;
- atomically write:
  - `.pro-code/runtime/workspace-manifest.json`
  - `.pro-code/runtime/workspace-report.md`
  - `.pro-code/runtime/automation-status.json`

The candidate ranking is a retrieval aid only. It does **not** establish authenticity, admissibility, relevance, or factual truth.

Configuration is bounded through environment variables such as:

- `PRO_CODE_WORKSPACE_DIR`
- `PRO_CODE_RUNTIME_DIR`
- `PRO_CODE_AUTOMATION_ENABLED`
- `PRO_CODE_AUTOMATION_INTERVAL_MS`
- `PRO_CODE_MAX_FILES`
- `PRO_CODE_MAX_HASH_BYTES`

### 3. Dispatch and security contract

The TypeScript worker layer and local Nexus enforce a fail-closed request shape around:

- case identity;
- task and trace identity;
- idempotency identity;
- capability ownership;
- allowed tools and source references;
- human-review requirements;
- external-action prohibition for the local contract;
- explicit acknowledgement before success.

Transport credentials remain outside the serialized browser request envelope. A future authenticated deployment must supply its own trusted authorization/signature boundary and receipts.

### 4. Memory boundary

Browser memory remains local. The Nexus runtime can persist a memory snapshot to Aspen- or Gemini-named filesystem targets **only when the corresponding local directory environment variable is explicitly configured**. An unconfigured target returns `unsupported`; this is not a claim of live Aspen Grove or Gemini service integration.

### 5. Native policy boundaries

| Component | Language | Verified repository role |
|---|---|---|
| UI and worker dispatch | TypeScript / React | operator state, envelopes, dispatch behavior |
| Local Nexus runtime | JavaScript / Node | local health, validation, receipts, local context/runtime boundary |
| Workspace automation | JavaScript / Node | bounded local inventory, hashes, duplicates, deltas, candidate ranking |
| Safety governor | Rust | bounded call-depth state machine |
| AST validator | Haskell | pure safe/dangerous/error-node invariants |
| Repository checks | Python | package/repository contract checks |

Polyglot count is not a quality metric. Languages remain only where they have a distinct verified boundary.

## Failure behavior

The current system fails or bounds behavior when:

- a dispatch envelope is malformed;
- a worker or capability is unknown;
- case/trace/idempotency headers disagree with the envelope;
- required human-review or external-action constraints are absent;
- a request exceeds the local body limit;
- idempotency identity is reused with conflicting content;
- an optional filesystem target is not configured;
- workspace scan bounds are exceeded or a file cannot be safely hashed;
- runtime or UI tests detect contract drift.

Automatic workspace analysis deliberately skips or bounds expensive/risky traversal rather than treating “scan everything” as a correctness requirement.

## Engineering operating protocol

The repository preserves the broader operating doctrine in [`docs/ENGINEERING_OPERATING_PROTOCOL.md`](docs/ENGINEERING_OPERATING_PROTOCOL.md):

```text
DISCOVER → BIND AUTHORITY → REUSE → SELECT BOUNDARY
→ IMPLEMENT → VERIFY → REPAIR → PERSIST → REPORT
```

References to AKOS, Tower of Babel, Pro_Code, Helix, Aspen Grove, Gemini, APEX, or Mastermind do not inherit integration status. Each external relationship requires its own reachable/authenticated receipt.

## Machine entrypoint

```yaml
schema: glaciereq.readme.v1
repository: GlacierEQ/pro-code
canonical_branch: main
purpose: >-
  Provide a runnable local engineering operator with governed case-scoped
  dispatch, explicit idempotent receipts, bounded workspace intelligence,
  and native polyglot policy checks.
status:
  state: LOCAL_OPERABLE
  evidence_level: TEST
  evidence_head: c1fbf3f3d28f596d28903fa2f8a91c7fbaecb6af
  verified_surfaces:
    - React and TypeScript operator/dispatch behavior
    - local Node Nexus health and dispatch contract
    - idempotent local execution receipts and conflict rejection
    - automatic bounded workspace inventory
    - SHA-256 hashing and exact duplicate grouping
    - workspace added/modified/removed deltas
    - heuristic evidence-candidate ranking with explicit truth boundary
    - optional configured local filesystem memory snapshots
    - TypeScript lint, type-check, tests, and Vite build
    - Python repository checks
    - native Rust governor execution
    - native Haskell AST invariant execution
  unverified_or_external_scope:
    - production deployment
    - a remote worker fleet
    - external provider authentication or authorization
    - live remote Mastermind or APEX mesh connectivity
    - OpenAI, Gemini, Aspen Grove, Notion, or other service integration unless separately configured and receipted
    - external action execution
    - production reliability, latency, throughput, scale, or availability
interfaces:
  inputs:
    - local HTTP requests and governed dispatch envelopes
    - case, task, trace, and idempotency identity
    - bounded capability parameters and constraints
    - configured workspace path and automation limits
    - optional explicitly configured local memory target directories
  outputs:
    - succeeded, failed, rejected, or unsupported local runtime results
    - bounded local execution receipts
    - workspace manifest, report, and automation status artifacts
    - exact duplicate groups and change deltas
    - heuristic candidate rankings labeled as retrieval aids
relationships:
  - target: GlacierEQ/AKOS
    relation: GOVERNANCE_REFERENCE
    evidence: no automatic runtime integration inheritance
  - target: GlacierEQ/the-tower-of-babel
    relation: LANGUAGE_POLICY_REFERENCE
    evidence: language-placement policy reference only
  - target: GlacierEQ/job-app-helix
    relation: PORTFOLIO_EVIDENCE_TARGET
    evidence: Helix evaluates receipts but does not replace repository-native proof
limits:
  - Local Nexus execution is not production deployment.
  - A declared worker capability is not proof of a deployed external worker.
  - Workspace candidate ranking does not establish evidentiary truth.
  - Configured filesystem synchronization is not proof of a remote service integration.
  - No external provider or action is exercised merely by repository-local CI.
```

## Repository map

```text
src/
  App.tsx                 React operator surface
  workers.ts              typed dispatch/security/health contract
  workers.test.ts         TypeScript behavioral proof
  memory.ts               browser-local memory boundary
  governor.rs             native bounded-call governor
  ASTValidator.hs         pure AST validity rule

server/
  nexus.mjs               local governed HTTP runtime
  nexus.test.mjs          runtime/idempotency/context tests
  automation.mjs          bounded workspace intelligence
  automation.test.mjs     inventory/hash/duplicate/delta tests
  automatic-runtime.mjs   Nexus + automation startup lifecycle
  automatic-runtime.test.mjs

tests/
  ASTValidatorSpec.hs
  test_pro_code.py
  test_rust_governor.py

docs/
  ENGINEERING_OPERATING_PROTOCOL.md
  AUTOMATIC_OPERATOR.md

.github/workflows/
  ci.yml
  helix-verify.yml
```

## Truth boundary

Pro-Code now proves a useful **local** operator/runtime/automation system. The strong claim is not “everything is connected”; it is that local execution, validation, receipts, workspace analysis, and native policy boundaries are inspectable and testable while external capabilities remain explicitly bounded until separately authenticated and verified.
