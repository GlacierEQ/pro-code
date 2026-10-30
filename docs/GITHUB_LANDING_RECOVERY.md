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
