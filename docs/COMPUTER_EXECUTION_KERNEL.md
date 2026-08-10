# Pro-Code → Computer Execution Kernel

`GlacierEQ/pro-code` remains the governed engineering operator and local engineering runtime. `GlacierEQ/computer-user` is the canonical governed computer execution kernel used when engineering intent crosses into computer, browser, native-application, file, or external-UI action.

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

- Pro-Code owns engineering intent, operator state, local engineering dispatch, and its repository-native proof.
- AKOS owns the governing authority and completion contract.
- `computer-user` owns the actual governed computer-action boundary, adapter selection, action verification, and execution receipt.
- Pro-Code may consume the kernel's returned receipt without duplicating its adapter or computer-control authority.
- A declared relationship is not proof of live connectivity. Runtime integration becomes active only when an exact invocation/readback receipt proves the handoff.

## Canonical references

- `GlacierEQ/AKOS` — governance authority.
- `GlacierEQ/computer-user` — governed computer execution kernel.
- `GlacierEQ/monolith` — estate mapping and routing.
- `GlacierEQ/Pro_Code` — private engineering doctrine.

This relationship preserves Pro-Code's existing `governed_engineering_execution` role; it does not turn Pro-Code into the global computer-control runtime.
