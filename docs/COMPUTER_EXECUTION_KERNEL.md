# Pro-Code → Computer Execution Kernel

`GlacierEQ/pro-code` is an active engineering execution and innovation surface. `GlacierEQ/computer-user` is the **currently selected computer execution kernel** when engineering intent crosses into computer, browser, native-application, file, or external-UI action. The relationship is evidence-backed, revisable, and capability-preserving.

## Current verified selection state

- Computer-user selected repository-state pointer: `47de3e53dbf8f9bd10421a6b54a269e035a4b783`.
- AKOS source used by the verified transaction: `eac3cab001306225b99da41c37370528331966dd`.
- Pro-Code source used as the originator: `c6cbfc8c01db6533c163148457908b03f76e5461`.
- AKOS → running-kernel HTTP invocation and receipt acceptance are proven for the recorded transaction.
- Delegated caller identity is preserved and independently verified, allowing Pro-Code to remain the truthful receipt originator while AKOS verifies the execution record.
- A Pro-Code-originated live `kernel.health` invocation is proven. The final merge-guard transaction executed computer-user head `b6aa44b9d90fee4c9c935d958574e6fca0b17680` and returned receipt `277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6` with caller `GlacierEQ/pro-code`, executor `GlacierEQ/computer-user`, capability `kernel.health`, and AKOS acceptance `VERIFIED`.
- The final originator proof passed **203 PASS** and bound caller, trace, requested capability, receipt hash, and terminal receipt source SHA to the exact executed kernel head.
- Real Chromium/Puppeteer `browser.navigate` target readback remains proven in the supervised container runner, and durable task/receipt state survives verified container replacement.
- Persistent-host systemd activation and APEX/AKOS restart/readback contracts are implemented and test-verified.
- A credentialed resident production host has not yet been reached; **production deployment remains false**.

The selected computer-user repository pointer and the executed test head serve different proof purposes. The live receipt is bound to the exact reviewed pre-merge head actually executed by the runner. The later repository pointer is evidence of repository state and is not misrepresented as the source that generated the receipt.

## APEX relationship

```text
operator objective / engineering intent
          ↓
      pro-code
engineering execution • innovation • dispatch • workspace intelligence
          ↓
  APEX capability selection
          ↓
computer-user + AKOS verification
          ↓
computer/browser/native execution
          ↓
observation → verification → receipt → persisted learning
```

- Pro-Code owns its engineering intent, operator context, repository-native engineering work, and innovation loop.
- `computer-user` contributes the currently selected computer-action capability, adapter selection, durable execution, target-state verification, and execution receipts.
- AKOS contributes architecture, evidence-state checking, and independent receipt verification.
- None of these roles is permanent by designation. A stronger verified implementation may challenge or compose with the current route.
- Pro-Code may consume execution receipts without duplicating the lower-level computer-control mechanism.
- Dispatch envelopes identify `GlacierEQ/pro-code` as the caller and verification preserves that identity rather than rewriting it.
- Pro-Code claims live runtime integration because a Pro-Code-originated request is bound to an exact terminal kernel receipt and independently verified.
- This runtime-integration claim is **not** a production-deployment claim. The verified transaction used a supervised ephemeral loopback integration runner.
- Production deployment is not inferred from CI or container execution. It requires the persistent-host restart/readback gate to pass on a credentialed resident host.

## Proof record

Machine truth is recorded in `.glaciereq/computer-kernel.live-receipt.json` and `.glaciereq/nervous-system.node.json`.

Two proof stages are intentionally preserved and serve different purposes:

1. **Hardened behavioral proof.** Computer-user head `5881b9fc6c57599d059432499098fdf3636b7eb4` passed the strengthened 203-test gate after review added explicit capability and source-SHA binding. Its Pro-Code-originated behavioral receipt is `a0884186349595983e191f9a357adabdd4ec98a54c5aae54d5fb42d2a2d92b71`. This establishes the executable mechanism before the final machine-state projection.
2. **Final merge-guard proof.** Exact head `b6aa44b9d90fee4c9c935d958574e6fca0b17680` reran the entire 203-test transaction unchanged and returned receipt `277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6`. This proves the projection-only delta did not invalidate behavior and is the receipt used for Pro-Code's local runtime-integration claim.

The proof pairs are complementary: the **behavioral proof** establishes the mechanism, and the **merge-guard proof** establishes that the later tested source still reproduces it. `scripts/validate_nervous_system.py` pins those evidence values so accidental drift cannot silently promote a different claim.

The final merge-guard proof records:

- computer-user tested head: `b6aa44b9d90fee4c9c935d958574e6fca0b17680`
- computer-user selected repository pointer: `47de3e53dbf8f9bd10421a6b54a269e035a4b783`
- Pro-Code originator: `c6cbfc8c01db6533c163148457908b03f76e5461`
- AKOS verifier source: `eac3cab001306225b99da41c37370528331966dd`
- supervised public workflow run: `31537976922`
- Pro-Code receipt: `277c69fbdbc3a877bdbe3d69267d5fcecc682a56d38d309dd4da3bf8c641f7a6`
- tests: `203 PASS`
- production deployment: `false`

## Current external gate

The remaining production blocker is tracked in `GlacierEQ/computer-user` issue #20: identify a credentialed persistent host, activate the selected source, run current APEX/AKOS health and browser readback, restart the supervised service, and verify the same receipt afterward.

## Capability references

- `GlacierEQ/AKOS` — architecture, evidence-state validation, delegated-caller verification, and receipt acceptance.
- `GlacierEQ/computer-user` — computer execution kernel and originator proof.
- `GlacierEQ/monolith` — estate map and proven-relationship projection.
- `GlacierEQ/Pro_Code` — engineering doctrine and standards.

This relationship preserves Pro-Code as an engineering execution and innovation system. Computer control is a composable capability, not a permanent global gate.
