# Pro-Code → Governed Computer Execution Kernel

`GlacierEQ/pro-code` remains the governed engineering operator/runtime context. `GlacierEQ/computer-user` is the canonical governed computer execution kernel used when engineering intent crosses into computer, browser, native-application, file, or external-UI action.

## Current canonical state

- Computer-user canonical main: `fe61227a97071c1bd3146f87b9bb0849874f844e`.
- Canonical AKOS main: `079956542500fcfcdf161e88ed81c73e770de49d`.
- AKOS → running-kernel HTTP invocation and receipt acceptance are proven.
- Real Chromium/Puppeteer `browser.navigate` target readback is proven in the governed container runner.
- Durable task/receipt state survives verified container replacement.
- Persistent-host systemd activation and canonical-AKOS restart/readback contracts are implemented and test-verified.
- A credentialed resident production host has not yet been reached; production deployment remains false.

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
- AKOS owns governing authority and receipt acceptance.
- `computer-user` owns the governed computer-action boundary, capability/adapter selection, durable execution, target-state verification, and execution receipts.
- Pro-Code may consume kernel receipts without duplicating browser/computer-control authority.
- The kernel's runtime is proven, but Pro-Code itself does **not** claim a live invocation until a Pro-Code-originated request is bound to an exact kernel receipt.
- Production deployment is not inferred from container CI. It requires the persistent-host AKOS restart/readback gate to pass on a credentialed resident host.

## Current external gate

The remaining production blocker is tracked in `GlacierEQ/computer-user` issue #20: identify a credentialed persistent host, activate exact canonical source, run canonical AKOS health/browser readback, restart the supervised service, and verify the same receipt afterward.

## Canonical references

- `GlacierEQ/AKOS` — governance and receipt acceptance.
- `GlacierEQ/computer-user` — governed computer execution kernel.
- `GlacierEQ/monolith` — estate map and proven-relationship projection.
- `GlacierEQ/Pro_Code` — private engineering doctrine.

This relationship preserves Pro-Code's existing `governed_engineering_execution` role; it does not turn Pro-Code into the global computer-control runtime.
