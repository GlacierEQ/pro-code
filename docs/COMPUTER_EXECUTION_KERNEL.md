# Pro-Code → Governed Computer Execution Kernel

`GlacierEQ/pro-code` remains the governed engineering operator/runtime context. `GlacierEQ/computer-user` is the canonical governed computer execution kernel used when engineering intent crosses into computer, browser, native-application, file, or external-UI action.

## Current canonical state

- Computer-user canonical main: `47de3e53dbf8f9bd10421a6b54a269e035a4b783`.
- Canonical AKOS main: `eac3cab001306225b99da41c37370528331966dd`.
- Canonical Pro-Code main used as the originator: `c6cbfc8c01db6533c163148457908b03f76e5461`.
- AKOS → running-kernel HTTP invocation and receipt acceptance are proven.
- AKOS preserves and independently verifies delegated caller identity, allowing Pro-Code to remain the truthful receipt originator while AKOS remains the governor/verifier.
- A Pro-Code-originated live `kernel.health` invocation is now proven. The final merge-guard transaction executed computer-user head `b6aa44b9d90fee4c9c935d958574e6fca0b17680` and returned receipt `277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6` with caller `GlacierEQ/pro-code`, executor `GlacierEQ/computer-user`, capability `kernel.health`, and AKOS acceptance `VERIFIED`.
- The final originator proof passed 203 tests and bound caller, trace, requested capability, receipt hash, and the terminal receipt source SHA to the exact executed kernel head.
- Real Chromium/Puppeteer `browser.navigate` target readback remains proven in the governed container runner, and durable task/receipt state survives verified container replacement.
- Persistent-host systemd activation and canonical-AKOS restart/readback contracts are implemented and test-verified.
- A credentialed resident production host has not yet been reached; production deployment remains false.

The canonical computer-user merge SHA is a repository-state pointer. The live receipt is correctly bound to the exact reviewed pre-merge head that was executed by the governed runner; the merge SHA is **not** presented as the source that generated that receipt.

## Responsibility split

```text
operator / engineering intent
          ↓
      pro-code
engineering context • dispatch • workspace intelligence
          ↓
     AKOS authority
          ↓
    computer-user
computer/browser/native execution piston
          ↓
observation → verification → receipt
```

## Contract

- Pro-Code owns engineering intent, operator state, local engineering dispatch, and repository-native engineering proof.
- AKOS owns governing authority and independent receipt acceptance.
- `computer-user` owns the governed computer-action boundary, capability/adapter selection, durable execution, target-state verification, and execution receipts.
- Pro-Code may consume kernel receipts without duplicating browser/computer-control authority.
- Pro-Code dispatch envelopes identify `GlacierEQ/pro-code` as the caller; canonical AKOS verifies that identity rather than rewriting it.
- Pro-Code now **does** claim live runtime integration because a Pro-Code-originated request is bound to an exact terminal kernel receipt and independently accepted by canonical AKOS.
- This runtime-integration claim is not a production-deployment claim. The verified transaction used a governed ephemeral loopback integration runner.
- Production deployment is not inferred from CI or container execution. It requires the persistent-host AKOS restart/readback gate to pass on a credentialed resident host.

## Proof record

Machine truth is recorded in `.glaciereq/computer-kernel.live-receipt.json` and `.glaciereq/nervous-system.node.json`.

Two proof stages are intentionally preserved and serve different purposes:

1. **Hardened behavioral proof.** Before the final machine-state projection, computer-user head `5881b9fc6c57599d059432499098fdf3636b7eb4` passed the strengthened 203-test gate after review added explicit capability and source-SHA binding. Its Pro-Code-originated behavioral receipt is `a0884186349595983e191f9a357adabdd4ec98a54c5aae54d5fb42d2a2d92b71`. This pair is the independent behavioral evidence stored canonically by computer-user in `machine/pro-code-originated-live-receipt-proof.json`.
2. **Final merge-guard proof.** After the earned machine projection was added, exact head `b6aa44b9d90fee4c9c935d958574e6fca0b17680` reran the entire 203-test transaction unchanged and returned receipt `277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6`. This proves the projection-only delta did not invalidate behavior and is the receipt used for Pro-Code's local runtime-integration claim.

The two hash pairs are therefore complementary, not competing: the **behavioral proof** establishes the mechanism before projection, and the **merge-guard proof** proves the frozen post-projection head still reproduces the mechanism. Both pairs are pinned by `scripts/validate_nervous_system.py` so either drifting causes the contract gate to fail.

The final merge-guard proof used:

- computer-user tested head: `b6aa44b9d90fee4c9c935d958574e6fca0b17680`
- computer-user canonical merge: `47de3e53dbf8f9bd10421a6b54a269e035a4b783`
- Pro-Code originator: `c6cbfc8c01db6533c163148457908b03f76e5461`
- AKOS verifier: `eac3cab001306225b99da41c37370528331966dd`
- governed public workflow run: `31537976922`
- Pro-Code receipt: `277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6`
- tests: `203 PASS`
- production deployment: `false`

## Current external gate

The remaining production blocker is tracked in `GlacierEQ/computer-user` issue #20: identify a credentialed persistent host, activate exact canonical source, run canonical AKOS health/browser readback, restart the supervised service, and verify the same receipt afterward.

## Canonical references

- `GlacierEQ/AKOS` — governance, delegated-caller verification, and receipt acceptance.
- `GlacierEQ/computer-user` — governed computer execution kernel and canonical originator proof.
- `GlacierEQ/monolith` — estate map and proven-relationship projection.
- `GlacierEQ/Pro_Code` — private engineering doctrine.

This relationship preserves Pro-Code's existing `governed_engineering_execution` role; it does not turn Pro-Code into the global computer-control runtime.
