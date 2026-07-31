# Pro-Code — Governed Polyglot Engineering Workbench

> A React and TypeScript operator surface for fail-closed worker dispatch, supported by native Rust and Haskell policy checks and repository-owned verification.

[![Pro-Code native verification](https://github.com/GlacierEQ/pro-code/actions/workflows/ci.yml/badge.svg)](https://github.com/GlacierEQ/pro-code/actions/workflows/ci.yml)

**Version:** `0.2.0`  
**Canonical repository:** `GlacierEQ/pro-code`  
**Canonical branch:** `main`  
**Current posture:** `HARDENING`

Pro-Code is the public executable strand of the GlacierEQ engineering doctrine. It demonstrates a bounded worker-dispatch interface and language-specific correctness checks. It does **not** claim that every linked repository, worker, connector, memory system, or provider is currently deployed or connected.

## The operator-facing system

### What it does

The implemented product is a Vite and React application backed by a typed worker-dispatch module.

It provides:

- 15 declared worker roles with explicit capability ownership;
- case-scoped, idempotent request envelopes;
- human-review and external-action constraints;
- transport-only authentication hooks that keep bearer credentials out of serialized envelopes;
- detached-signature metadata support;
- rejection of unknown capabilities before network access;
- failure on missing case context, transport errors, runtime rejection, and ambiguous success responses;
- runtime health synchronization that preserves a manual pause;
- a native Rust call-depth governor;
- a native Haskell AST validity boundary.

A registry entry is not a deployed worker. A successful HTTP status is not proof of completed work. Pro-Code reports success only after an explicit runtime acknowledgement.

### Fast proof path

| Inspect or run | What it establishes |
|---|---|
| [`src/workers.ts`](src/workers.ts) | Typed envelopes, capability routing, failure semantics, health projection, and security hooks. |
| [`src/workers.test.ts`](src/workers.test.ts) | Case context, idempotency, auth separation, acknowledgement, unknown-capability, transport, and pause-preservation behavior. |
| [`src/governor.rs`](src/governor.rs) | Native bounded-call state machine and Rust unit tests. |
| [`src/ASTValidator.hs`](src/ASTValidator.hs) | Pure recursive AST validity rule. |
| [`tests/ASTValidatorSpec.hs`](tests/ASTValidatorSpec.hs) | Native Haskell invariants for safe actions, dangerous deletion, and error nodes. |
| [`src/App.tsx`](src/App.tsx) | Human-facing React operator surface. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | TypeScript lint/build/test and native Python, Rust, and Haskell gates. |

## Engineering anatomy

### Runtime boundary

```text
operator interaction
        │
        ▼
React application
        │
        ▼
WorkersManager
capability lookup • case scope • idempotency • constraints
        │
        ├── reject before transport
        │      missing case • unknown capability • auth failure
        │
        ▼
trusted auth/signature hook
        │
        ▼
HTTP runtime request
        │
        ├── failed / ambiguous / rejected ──► explicit failure result
        │
        ▼
explicit runtime acknowledgement
        │
        ▼
succeeded result + reviewable envelope
```

The browser does not hold signing secrets. A deployment may inject a trusted hook that supplies transport headers and detached signature metadata. Serialized envelopes may contain non-secret identity and signature metadata, but not the transport bearer credential.

### Implemented components

| Component | Language | Responsibility | Evidence |
|---|---|---|---|
| Worker dispatch and health | TypeScript | Typed requests, capability routing, fail-closed results, runtime synchronization | Vitest behavior suite and production build |
| Operator interface | React / TypeScript / CSS | Human-facing request and status surface | Lint, type-check, tests, and Vite build |
| Safety governor | Rust | Bound concurrent or nested call capacity | Native `rustc --test` execution |
| AST validator | Haskell | Reject dangerous actions and explicit error nodes | Native GHC compile and executable invariants |
| Repository checks | Python | Package identity and supporting contract tests | `unittest` execution |
| Mastermind sidecar | Python | Local process uptime and repository identity | Local source only; no remote Mastermind connection is claimed |

### Fail-closed behavior

The worker contract rejects or fails when:

- no registered worker owns the requested capability;
- case context is missing;
- authentication preparation throws;
- transport fails;
- the runtime rejects the request;
- a `2xx` response does not explicitly acknowledge success;
- response content is malformed;
- health synchronization cannot reach the runtime.

The memory layer also fails honestly: browser-local memory is implemented, but Aspen Grove and Gemini filesystem synchronization return `false` until a trusted filesystem bridge exists.

### Engineering operating protocol

The concurrent mainline contribution introduced a useful operating sequence. It is preserved as doctrine—not runtime proof—in [`docs/ENGINEERING_OPERATING_PROTOCOL.md`](docs/ENGINEERING_OPERATING_PROTOCOL.md).

```text
DISCOVER → BIND AUTHORITY → REUSE → SELECT BOUNDARY
→ IMPLEMENT → VERIFY → REPAIR → PERSIST → REPORT
```

The protocol never converts a repository link into integration evidence. Every linked system remains `REFERENCE`, `INTENDED_RELATIONSHIP`, or `VERIFIED_INTEGRATION` according to its receipts.

### Verification

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --reporter=verbose
npm run build

python -m unittest discover -s tests -p 'test_*.py' -v

rustc --edition 2021 --test src/governor.rs -o /tmp/pro-code-governor-tests
/tmp/pro-code-governor-tests

ghc -Wall -Werror -isrc tests/ASTValidatorSpec.hs -o /tmp/pro-code-ast-tests
/tmp/pro-code-ast-tests
```

### Language placement

| Technology | Boundary it serves |
|---|---|
| TypeScript | Browser/runtime contracts, typed envelopes, and asynchronous failure states |
| React | Human-facing operator state and interaction |
| Rust | Small bounded state machine with native memory-safe execution |
| Haskell | Pure recursive invariant expression with algebraic data types |
| Python | Lightweight repository checks and local serialization |

Polyglot count is not a quality metric. A language belongs only when it creates measurable value at a clear boundary. Tower of Babel remains the policy authority for broader language placement.

## Machine entrypoint

```yaml
schema: glaciereq.readme.v1
repository: GlacierEQ/pro-code
canonical_branch: main
purpose: >-
  Provide a typed, fail-closed operator workbench for preparing and reviewing
  worker-dispatch requests, with native Rust and Haskell policy examples.
status:
  state: HARDENING
  evidence_level: UNVERIFIED_PENDING_CURRENT_PR_CI
  candidate_proof_gates:
    - TypeScript lint and type-check
    - 16 worker-dispatch behavior tests
    - Vite production build
    - Python unittest discovery
    - native Rust unit execution
    - native Haskell invariant execution
  unverified_scope:
    - a reachable Nexus or Mastermind runtime
    - deployment of the 15 declared worker roles
    - Aspen Grove or Gemini filesystem synchronization
    - provider authentication or authorization
    - external action execution
    - production reliability, scale, latency, or throughput
interfaces:
  inputs:
    - capability name
    - case, task, trace, and idempotency identity
    - bounded parameters and allowed-tool constraints
    - optional trusted auth/signature hook
  outputs:
    - succeeded, failed, or rejected dispatch result
    - reviewable non-secret request envelope
    - runtime health projection
relationships:
  - target: GlacierEQ/Pro_Code
    relation: PAIRED_WITH
    evidence: private doctrine strand; no automatic inheritance claimed
  - target: GlacierEQ/AKOS
    relation: GOVERNANCE_REFERENCE
    evidence: authority and completion semantics are referenced, not presumed connected
  - target: GlacierEQ/the-tower-of-babel
    relation: LANGUAGE_POLICY_REFERENCE
    evidence: placement policy is referenced; runtime integration requires separate proof
  - target: GlacierEQ/job-app-helix
    relation: PORTFOLIO_EVIDENCE_TARGET
    evidence: Helix may evaluate receipts but cannot replace native repository proof
limits:
  - Registry status does not establish remote deployment.
  - The Python governor simulation is supporting documentation, not native Rust proof.
  - The local sidecar reports only its own process health.
  - No external provider or action is exercised by repository-local CI.
```

## Repository map

```text
src/
  App.tsx                 React operator surface
  workers.ts              dispatch, security, and health contract
  workers.test.ts         TypeScript behavioral proof
  memory.ts               browser-local memory and blocked bridge semantics
  governor.rs             native bounded-call governor
  ASTValidator.hs         pure AST validity rule

tests/
  ASTValidatorSpec.hs     native Haskell invariant execution
  test_pro_code.py        package identity check
  test_rust_governor.py   supporting Python simulation, not native proof

docs/
  ENGINEERING_OPERATING_PROTOCOL.md

.github/workflows/ci.yml  repository-native verification
mastermind_sidecar.py     local health serialization only
```

## Truth boundary

Pro-Code demonstrates a bounded operator and dispatch contract. It does not claim that linked systems are connected, that declared workers are deployed, that external actions are authorized, or that repository-local tests establish production behavior. Those states require authenticated, environment-specific receipts.
