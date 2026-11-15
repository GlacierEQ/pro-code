# PRO-CODE — live harness evaluation (v1)

This is an **executable, controlled local-component ablation**, not a paper benchmark or a self-scored model improvement. It measures whether the existing Nexus server actually handles recovery and authorization differently with its durable dispatch journal enabled, while keeping the source revision, deterministic worker fixture, inputs, environment and lack of LLM inference identical.

## Run

```bash
npm ci
npm run eval:harness
npm run eval:harness -- --out .pro-code/runtime/harness-evaluation.json
npm run test:harness-evaluation
```

The strict command emits JSON and exits nonzero unless all durable cases pass **and** durable cases pass more correctness checks than bare Nexus. CI also saves the exact machine-readable evidence as an Actions artifact named `harness-evidence-<github.sha>-attempt-<github.run_attempt>` using a commit-pinned uploader, with requested retention up to 90 days (subject to repository retention policy). The uploader runs even after a failed evaluation step, explicitly includes the narrowly scoped hidden JSON path, and fails if the expected file is missing rather than reporting success without evidence. CI runs this on an exact GitHub checkout; the output is in its native Actions log. When a local `--out` path is selected explicitly, the runner writes a private (0600) JSON snapshot via a temporary file and atomic rename.

## Actual evaluated component and causal hypothesis

- **Baseline:** the exact same `startNexusServer` with `journalDir = null` (bounded in-memory idempotency).
- **Candidate:** the exact same `startNexusServer` with `journalDir` pointing at an isolated temporary directory (durable claims and completion receipts).
- **Hypothesis:** enabling the journal prevents duplicate worker executions on a controlled restart, rejects a conflicting key after restart, and refuses to repeat a seeded uncertain claim, without reducing already-correct safety behavior.
- **Input control:** identical versioned request envelopes and fixture operations, no network calls other than loopback HTTP to servers created by the runner. The test isolates `PRO_CODE_ALLOWED_ORIGINS` from the launching shell and uses bounded HTTP deadlines.
- **Operator authority and evidence:** the fixture grants no external actions and the tested worker only returns a deterministic `workspace_inventory` response. Unsupported worker requests remain unsupported. The runner does not write to any connected provider or user repository.
- **Control:** `dataset_sha256` hashes the seven scenario specifications **and executable evaluator/runtime source**, and `executable_source_sha256` identifies their exact bytes; `source_revision` is populated from `GITHUB_SHA` in CI or supplied by the caller (null for an unpinned local checkout). `model: null` means no model was called or compared.
- **Tasks:** `sequential_replay`, `concurrent_replay`, `restart_replay`, `restart_conflict`, `uncertain_claim`, `unsupported_capability`, and `foreign_origin`.
- **Oracle:** executable HTTP status and receipt checks, exact response equivalence for replay, and independent fixture invocation counts. A generated narrative cannot change a pass/fail decision.
- **Reported metrics:** correctly handled cases / total and summed worker invocations, plus per-case response status and replay evidence.

## Measured-evidence admission

The existing `server/innovation.mjs` now provides `assessMeasuredHarnessEvidence(record)`. The live evaluator calls this pure admission function on its actual observations and records an `evidence_gate` object. The gate independently recalculates paired pass counts and worker invocations from the per-case records, checks identical task IDs and expected behavior, rejects missing or duplicate cases, invalid hashes, changed evaluation scope, structural regressions, infrastructure failures and inflated summaries.

An accepted record reports `accept_local_component_evidence`, `approval_to_deploy: false`, and `model_capability_gain_verified: false`. This is **a schema and internal-consistency check on local execution evidence**, not cryptographic attestation that an external action happened. Native CI remains an additional requirement. The preexisting subjective `selectMaximumCoherentAdvance` scoring remains a hypothesis/prioritization tool; it cannot substitute for measured admission.

## Promotion and claims

The runner makes a **specific causal durability claim** only if the recorded comparison passes. It does not establish a newly intelligent LLM, SWE-bench/Terminal-Bench performance, context-memory gains, independent human outcomes, provider side-effect exactly-once behavior, a crash-kill recovery test, a held-out benchmark, or superiority of all possible harness configurations.

When integrating model-backed work, add independent fixed and held-out task corpora, separate task sources, pinned model/tool settings and budgets, trace-grounded task oracles, contamination checks, statistical confidence, and explicit permission scopes. Preserve failed trial records and do not train on the held-out tests.

Research mechanisms to consider after establishing trustworthy baselines: AHE's component/experience/decision observability (https://arxiv.org/abs/2604.25850), HarnessFlow's controlled harness search (https://arxiv.org/abs/2611.06254), and GEPA's feedback-led candidate optimization (https://github.com/gepa-ai/gepa). These are **references**, not claims that those external systems run inside GlacierEQ.

## Continuation

1. Extend the existing durable journal with source-native reconciliation **only** when an exact authoritative worker/provider artifact can be matched to its pending claim; never complete an uncertain task using proximity or another task's manifest.
2. Evaluate correction-aware memory, context retrieval and code-completion workflows against distinct current/stale/wrong-project fixtures and real repository tasks.
3. Connect evidence-accepted local experiments to a held-out, model-backed task corpus and source-native execution traces before any broader harness optimization or production promotion. Keep subjective forecast scores separate from observed acceptance.
4. After comparison on actual model-backed engineering tasks, promote verified changes with regressions, security, costs and rollback tested.
