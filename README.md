# Pro-Code — Governed Polyglot Engineering Workbench

> A React and TypeScript worker-dispatch interface with fail-closed execution contracts, plus small native Rust and Haskell correctness boundaries that are verified in their own languages.

[![Pro-Code native verification](https://github.com/GlacierEQ/pro-code/actions/workflows/ci.yml/badge.svg)](https://github.com/GlacierEQ/pro-code/actions/workflows/ci.yml)

**Version:** `0.2.0`  
**Canonical repository:** `GlacierEQ/pro-code`  
**Canonical branch:** `main`  
**Current posture:** `HARDENING` — native verification has been introduced on the hardening branch; promotion to a verified release depends on the repository workflow passing after merge.

Pro-Code is not a generic claim of a fully connected engineering fleet. It is an inspectable workbench that demonstrates how a browser-facing operator surface can prepare bounded worker requests, reject unsafe or ambiguous outcomes, and place small policy checks in languages selected for the boundary they serve.

## The operator-facing system

### What it does

The primary implemented product is a Vite and React application backed by a typed worker-dispatch module.

It provides:

- a registry of 15 named worker roles and their declared capabilities;
- case-scoped, idempotent request envelopes;
- explicit human-review and external-action constraints;
- transport-only authentication hooks that keep bearer credentials out of serialized envelopes;
- detached-signature metadata support;
- rejection of unknown capabilities before network access;
- failure on missing case context, transport errors, runtime rejection, and ambiguous success responses;
- runtime health synchronization that does not overwrite a manual pause;
- a small Rust call-depth governor and Haskell AST validator as native policy examples.

### Why it matters

Agent and automation interfaces often make a dangerous category error: they treat a successful HTTP transport, a declared worker, or a local fallback as proof that work completed. Pro-Code models the opposite behavior. A request is successful only when the runtime explicitly acknowledges success, and the UI-facing contract preserves the evidence needed to review what was requested.

### Proof path

| Inspect or run | What it establishes |
|---|---|
| [`src/workers.ts`](src/workers.ts) | Typed dispatch envelopes, capability ownership, fail-closed result handling, health checks, and security hooks. |
| [`src/workers.test.ts`](src/workers.test.ts) | Behavioral tests for case context, idempotency, auth separation, explicit acknowledgement, unknown capabilities, transport failure, and pause preservation. |
| [`src/governor.rs`](src/governor.rs) | Native Rust depth-limiting state machine with embedded unit tests. |
| [`src/ASTValidator.hs`](src/ASTValidator.hs) | Native Haskell AST invariant evaluator. |
| [`tests/ASTValidatorSpec.hs`](tests/ASTValidatorSpec.hs) | Executable Haskell invariants for safe actions, dangerous deletion, and error nodes. |
| [`src/App.tsx`](src/App.tsx) | React operator surface. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Repository-native TypeScript, Python, Rust, Haskell, and production-build gates. |

## Engineering anatomy

### System boundary

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
auth/signature hook at trusted boundary
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

The browser does not hold signing secrets. Deployments may inject a hook that supplies transport headers and detached signature metadata. The serialized envelope can include non-secret authentication identity and a signature, but not the bearer credential used by the transport.

### Implemented components

| Component | Language | Responsibility | Current evidence |
|---|---|---|---|
| Worker dispatch and health | TypeScript | Typed requests, capability routing, fail-closed outcomes, runtime synchronization | Vitest behavior suite and TypeScript build gate |
| Operator interface | React / TypeScript / CSS | Human-facing control and status surface | Type-check, lint, tests, and Vite production build |
| Safety governor | Rust | Bound concurrent or nested tool-call capacity | Native `rustc --test` execution |
| AST validator | Haskell | Reject dangerous actions and explicit error nodes | Native GHC compile plus executable invariant test |
| Repository metadata tests | Python | Confirm package identity and document the earlier governor simulation | `unittest` execution; simulation is not counted as native Rust proof |
| Mastermind sidecar | Python | Serialize local process uptime and repository identity | Source is inspectable; no remote Mastermind connection is claimed |

### Fail-closed behavior

The worker contract deliberately rejects or fails when:

- no registered worker owns a requested capability;
- a request lacks explicit case context;
- an authentication hook throws;
- transport fails;
- the runtime rejects the request;
- a `2xx` response does not explicitly acknowledge success;
- response content is malformed;
- health synchronization cannot reach the runtime.

A local fallback is never converted into a live success. Declared workers are registry entries, not proof that 15 remote processes are deployed or reachable.

### Build and verification

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

The GitHub Actions workflow runs these as two read-only jobs: TypeScript application verification and native Python/Rust/Haskell contract verification.

### Language placement

| Technology | Why it belongs here | Why another layer does not own it |
|---|---|---|
| TypeScript | Dispatch envelopes, browser/runtime interfaces, and asynchronous failure states benefit from static structural contracts. | Rust or Haskell would add friction at the web boundary without improving browser reach. |
| React | The implemented product is an operator interface with interactive state and runtime status. | Static HTML would not model the application state or dispatch flow. |
| Rust | The governor is a tiny native state machine where bounded mutation and direct unit execution are useful. | It is not used to rewrite the web application or imply a complete Rust backend. |
| Haskell | The AST example expresses a pure recursive validity rule with algebraic data types. | It is a bounded invariant demonstration, not a claim that the application runtime is Haskell. |
| Python | Lightweight repository checks and local sidecar serialization. | Python tests do not substitute for executing native Rust or Haskell code. |

Additional languages belong only when they create measurable value at a clear boundary. Polyglot count is not a quality metric.

## Machine entrypoint

```yaml
schema: glaciereq.readme.v1
repository: GlacierEQ/pro-code
canonical_branch: main
purpose: >-
  Provide a typed, fail-closed operator workbench for preparing and reviewing
  worker dispatch requests, with bounded native Rust and Haskell policy examples.
status:
  state: HARDENING
  evidence_level: UNVERIFIED_PENDING_BRANCH_CI
  verified_on_main:
    - inspectable TypeScript, React, Rust, Haskell, and Python source
    - checked-in TypeScript behavior tests
  candidate_proof_gates:
    - npm lint, typecheck, Vitest, and production build
    - Python unittest discovery
    - native rustc unit execution
    - native GHC compile and invariant execution
  unverified_scope:
    - a reachable Nexus or Mastermind runtime
    - deployment of the 15 declared worker roles
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
  commands:
    install: npm ci
    lint: npm run lint
    typecheck: npm run typecheck
    test: npm test -- --reporter=verbose
    build: npm run build
    rust_test: rustc --edition 2021 --test src/governor.rs
    haskell_test: ghc -Wall -Werror -isrc tests/ASTValidatorSpec.hs
relationships:
  - target: GlacierEQ/Pro_Code
    relation: PAIRED_WITH
    boundary: >-
      Pro_Code contains private operator doctrine and style context; pro-code
      contains the public executable workbench and repository-native proof.
  - target: GlacierEQ/AKOS
    relation: GOVERNED_BY
    boundary: >-
      AKOS supplies authority, evidence, persistence, and completion semantics;
      this relationship does not prove a live runtime integration.
  - target: GlacierEQ/job-app-helix
    relation: VERIFIED_BY_PORTFOLIO_CONTROL_PLANE
    boundary: >-
      Helix may inventory and evaluate repository evidence but does not replace
      this repository's native build and test receipts.
limits:
  - Registry status labels do not establish remote deployment.
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
  governor.rs             native bounded-call governor
  ASTValidator.hs         pure AST validity rule

tests/
  ASTValidatorSpec.hs     native Haskell invariant execution
  test_pro_code.py        package identity check
  test_rust_governor.py   documented Python simulation, not native proof

ci/                       reusable workflow templates and examples
.github/workflows/ci.yml  repository-native verification
mastermind_sidecar.py     local health serialization only
```

## Truth boundary

Pro-Code demonstrates a bounded operator and dispatch contract. It does not claim that linked systems are connected, that declared workers are deployed, that external actions are authorized, or that repository-local tests establish production behavior. Those states require separate authenticated, environment-specific receipts.
