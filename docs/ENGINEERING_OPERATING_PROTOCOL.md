# Engineering Operating Protocol

This document preserves the operating doctrine introduced on `pro-code/main` while separating instruction from implementation evidence.

## Protocol

```text
DISCOVER
→ recover canonical context and topology
→ bind purpose, identity, constraints, and authority
→ reuse an existing repository, connector, schema, component, or execution plane
→ select the smallest justified language/runtime boundary
→ implement the smallest coherent change
→ execute repository-native checks
→ repair or reroute failures within authorization
→ add one measurable resilience or integration gain
→ verify the target state
→ persist artifacts, decisions, and receipts
→ report the completed result or exact exhausted blocker
```

## Non-negotiable rules

1. **Context before invention.** Recover available canonical context before designing from zero.
2. **Reuse before duplication.** Search existing implementations and contracts before adding a new surface.
3. **No novelty refactors.** Preserve working code unless measurable value requires change.
4. **Polyglot by boundary.** A language earns adoption through safety, performance, hardware fit, ecosystem fit, formal proof, or interoperability.
5. **Repair before failure reporting.** Attempt safe, authorized, bounded repair and rerouting before declaring a blocker.
6. **Receipts over claims.** A plan, patch, link, successful command, or HTTP status is not completion without target-state verification.
7. **Persist the gain.** A useful fix that is not merged, documented, or receipted remains fragile.
8. **Retire obsolete branches.** Preserve unique value, verify current ancestry, merge or close, delete the obsolete ref, and record the disposition.

## Relationship vocabulary

| State | Meaning |
|---|---|
| `REFERENCE` | A repository or document informs this work. No runtime relationship is implied. |
| `INTENDED_RELATIONSHIP` | A future or architectural relationship is declared but not exercised. |
| `CONFIGURED` | Configuration exists; reachability and health are unknown. |
| `REACHABLE` | A bounded probe reached the target. Functional integration is not yet established. |
| `VERIFIED_INTEGRATION` | A real boundary was exercised and produced a retained receipt. |
| `DEPLOYED` | Environment-specific deployment evidence exists. |

Relationships never promote automatically because a README links the repositories.

## Core references

- `GlacierEQ/AKOS` — governance, authority, evidence, persistence, and completion reference.
- `GlacierEQ/Pro_Code` — private engineering doctrine and operator-context strand.
- `GlacierEQ/the-tower-of-babel` — language-placement and interoperability policy reference.
- `GlacierEQ/job-app-helix` — portfolio inventory, proof evaluation, and consolidation control plane.
- `GlacierEQ/aspen-grove-core` and `GlacierEQ/apex-boot-core` — intended context and initialization references whose current runtime relationship must be proven separately.

## Current Pro-Code receipt boundary

This repository can prove its TypeScript dispatch behavior, production build, native Rust governor tests, native Haskell AST invariants, and Python repository checks when its CI passes. It cannot presently prove live memory recovery, connected governance, remote worker deployment, provider authorization, external action execution, or production scale.
