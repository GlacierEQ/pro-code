# GitHub landing continuity: additive recovery engine

`tools/github_ops/landing_journal.py` is a **connector-neutral, readback-backed journal**, not a second GitHub write client and not a replacement for the existing local `~/workspace/tools/github-ops/ghl.py`. It makes it possible for an authorized caller to persist intent, native connector invocation IDs, unknown outcomes, explicit declines, and verified readbacks **without blind duplicate writes**.

## Integration contract

1. Existing launcher remains the orchestrator; it is the only component that decides to submit a write through the native consented connector. The journal does not create, batch, authorize, or bypass approval cards. Do not run GitHub-token or `gh` write substitutes.
2. Before a write, register a **stable plan ID and step ID** with exact repository, object identity, operation and expected native readback. The journal rejects plan-identity drift.
3. **Before** issuing the host consented connector call, call `arm(plan, step)`; this reserves the step durably even if the foreground process disappears between calling the connector and recording its result. This is not authorization. After the host has actually invoked the call, record `attempt(plan, step, invocation_id)` when a native invocation identifier is available.
4. If foreground execution disappears, record `uncertain` or leave `ARMED` / `ATTEMPTED`; **do not call the write again**. Retrieve remote state using a native read operation and `reconcile` it against the exact expected head/object.
5. If the card is declined, call `declined` and stop that action. Do not restart it without a new user directive and plan identity.
6. `VERIFIED` means the expected remote state was observed after a recorded invocation; it cannot prove which client caused it. `ALREADY_SATISFIED` means the remote outcome was observed without a journal-recorded invocation (which can include a session-lost invocation). Neither means that every downstream deployment, release, or business objective is complete.

Only non-secret, bounded intent fields are accepted; readback is stored as a digest rather than as full provider payload. The journal deliberately uses a caller-supplied SQLite path, not a machine-specific hardcoded home directory. SQLite WAL, synchronous full write transactions, concurrent non-locking reads, hex-validated expected PR head IDs and unique provider invocation IDs support process restart and concurrent callers on one host. **Network-filesystem / multi-host exactly-once delivery is not proven.** Store one journal on a locally reliable disk per executing host.

## Example (readback-only illustration; no GitHub write is initiated)

A machine-provided intent JSON for an existing PR might be:

```json
{
  "operation": "merge_pr",
  "repository": "GlacierEQ/example",
  "target": "pull/10",
  "expected_head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "expected": {
    "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "state": "closed",
    "merged": true
  }
}
```

A corresponding independently fetched native snapshot can be:

```json
{
  "repository": "GlacierEQ/example",
  "target": "pull/10",
  "observed": {
    "head_sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "state": "closed",
    "merged": true
  }
}
```

Run `python -m unittest tests.test_landing_journal -v` and, for CLI help, `python -m tools.github_ops.landing_journal --help`. The portable module must be integrated into the original launcher **after reading its current source and verifying its existing CLI and approval behavior**. The original runner was not accessible in the 2026-10-29 session; **no claim of in-place integration** is made.

## Native GitHub readback integrated (GET-only)

The journal now includes `reconcile_native(plan, step)` and CLI action `native-reconcile`.
It reads the live GitHub PR **without initiating or retrying any write**, and
requires the exact expected PR head SHA, matching target repository and
`main` branch, proper merged/closed state, an actual merge commit, and
merge-commit ancestry on the current `main`. Unknown, timed-out,
inaccessible, altered-head or nonancestral results keep the original
journal state with `NATIVE_READBACK_UNAVAILABLE`. A declined step
is terminal and makes **zero provider requests**.

```sh
python3 -m tools.github_ops.landing_journal --db PATH native-reconcile \
  --plan YOUR_PLAN --step YOUR_STEP
python3 -m unittest tests.test_native_readback -v
```

This public-repository verifier uses GitHub REST **GET** only, no alternate
write authentication or consent bypass. Private/inaccessible repositories
need authenticated readback through the existing authorized connector or
a provider-native read path, not a fabricated success. The existing
`reconcile` API remains available for caller-supplied provider snapshots;
prefer `native-reconcile` for independently verified public PR state.

Observed against actual GitHub PR `GlacierEQ/pro-code#30` on 2026-10-29:
a new unattempted plan returned `ALREADY_SATISFIED` with matching server-side
merge and ancestry, not `VERIFIED` as if this tool had performed the write.
Nine additional negative and crash-lifecycle tests passed on an authorized
test environment. This is the repository's recovery functionality; no claim
is made that the separate detached local `ghl.py` runner was modified.

## Estate-specific do-not-touch targets

The operator's refusal to close `GlacierEQ/spacex-mission-control#3` is binding; `GlacierEQ/spacex-telemetry#5` and `#6` also remain open without further explicit direction. Do not load these as automatic cleanup work or create a plan to close them.

## Verified read-only estate demonstration

The included `evidence/live-github-readback-2026-10-29.json` records source links and exact public GitHub PR metadata fetched through the connected GitHub app. From the package root run `python -m evidence.live_readback_demo`. Both merged PRs classify as `ALREADY_SATISFIED`, **not** as an action performed by this runner. At the checked main revisions, mission-control's `machine/capabilities.json` has 13 entries and telemetry's has 19. Their capability count does not establish a SpaceX flight-system deployment.

## Multi-step landing sequences (new executable capability)

The single-step journal remains unchanged for existing callers. The additive
`tools/github_ops/landing_sequence.py` coordinates a **whole dependency graph**
of consented GitHub operations. It atomically installs up to 200 bounded,
immutable steps, resumes after session death, and reports which independent
work may proceed while an unrelated step is awaiting readback.

A sequence is not another approval system. It is an executable continuation map
for the original detached launcher: it prevents the caller from accidentally
repeating an unknown write, invoking a dependent step before its provider outcome
is confirmed, or treating a declined card as permission to continue.

### Run the sequence engine

From the repository root:

```sh
# Construct a manifest from the actual intended repository operations.
python -m tools.github_ops.landing_sequence --db "$STATE_DB" install --file landing-plan.json

# Read the current executable work frontier; no GitHub write is performed.
python -m tools.github_ops.landing_sequence --db "$STATE_DB" status --plan my-landing

# Before presenting the normal native connector consent card for a READY step:
python -m tools.github_ops.landing_sequence --db "$STATE_DB" arm --plan my-landing --step branch

# After a real native connector invocation, use the existing journal to record
# its invocation ID (never invent one). Unknown outcomes require readback first.
python -m tools.github_ops.landing_journal --db "$STATE_DB" attempt --plan my-landing --step branch --invocation PROVIDER_INVOCATION_ID

# Recover automatically through the existing public GitHub GET-only adapter.
# No connector write is performed; inaccessible/private PRs remain unresolved.
python -m tools.github_ops.landing_sequence --db "$STATE_DB" recover --plan my-landing

# Normalize independent native GitHub GET/readback data into JSON mapping
# step ID to its repository/target/observed fields; reconcile only, no mutation.
python -m tools.github_ops.landing_sequence --db "$STATE_DB" reconcile --plan my-landing --file native-readbacks.json
```

The JSON manifest uses `schema: glaciereq.github-landing-sequence.v1`,
`plan_id`, and `steps: [{id, depends_on, intent}]`. Each `intent` has
the original journal's exact fields `operation`, `repository`, `target`,
`expected`, and (for PR merge/close) `expected_head_sha`. Dependencies
are step IDs; cycles, unknown dependencies, duplicate identifiers, malformed
SHAs and credential fields are rejected before creating any step. A plan ID
cannot be silently repurposed to change its contents.

Status actions:
- `READY_TO_ARM`: dependencies have verified provider readbacks; invoke
  `arm` before the original host initiates its consented connector write.
- `RECONCILE_REMOTE_FIRST`: already armed, attempted or unresolved. Never
  blindly reissue the write after lost foreground state.
- `WAIT_DEPENDENCIES`: another step is not confirmed yet. Other independent
  ready steps are still surfaced.
- `STOPPED_BY_DECLINE`: direct or transitive prerequisite refused. This is
  terminally blocked, not a slow job to poll or blindly retry.
- `DECLINED_STOP`: consent was denied; do not resubmit without a fresh
  user directive.
- `COMPLETE`: native expected state matched. Complete refers to this step,
  not a claim that a whole business/deployment objective is finished.

Status reports both `complete` (every expected remote outcome observed)
and `terminal` (no further step can execute). A declined chain can be terminal
without being complete; that must never be called a successful landing.
Multi-step readback reconciliation is all-or-nothing: any error rolls back the
batch. Independent readback of pre-existing outcomes may mark steps
`ALREADY_SATISFIED`; that does not claim this runner invoked those writes.

Each GitHub write remains with the existing host and provider consent mechanism.
The sequence engine does not call GitHub, mint tokens, trigger approvals,
create a background daemon, or modify the original workstation `ghl.py`.
Automatic recovery uses the existing `native_readback.py` adapter only for
public `merge_pr` / `close_pr` targets, verifying exact PR head and merge
ancestry. Any inaccessible private PR, unsupported operation, rate limit or
missing provider evidence remains unresolved. Use consented provider-native
readbacks plus `reconcile` for those operations, not fake snapshots.
Its on-disk SQLite journal is scoped to the host holding it; do not claim
multi-host exactly-once guarantees.

Verification: `python -m unittest tests.test_landing_sequence -v`
covers dependency ordering, independent progress, process recovery, declines,
concurrent arm races, malformed plans, and complete four-step sequences.
