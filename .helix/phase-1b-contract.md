# Helix Phase 1B Enforcement Contract

Phase 1B turns the Phase 1A hidden substrate into an enforceable contract.

## Enforcement Surfaces

- JSON schemas define the required shape of hidden substrate files.
- `tools/helix_verify.py` verifies identity, role, paired-strand references, required files, and raw-secret drift.
- GitHub Actions runs the verifier on every push and pull request that touches the branch.
- `.audit/drift-rules.md` documents the drift conditions that should block promotion.

## Required Invariants

- A doctrine strand must identify itself as `doctrine_strand` in `.apex/repo-profile.json`.
- A doctrine strand must identify `.helix/strand.json` as `strand_type: doctrine`.
- A runtime strand must identify itself as `runtime_strand` in `.apex/repo-profile.json`.
- A runtime strand must identify `.helix/strand.json` as `strand_type: runtime`.
- Paired strands must point at each other by canonical `owner/repo` name.
- Hidden substrate must never contain raw secrets, raw tokens, raw private keys, or raw sensitive records.

## Branch Discipline

- Phase 1B is additive and runs from `helix-phase-1b`.
- `main` remains untouched until review and merge approval.
- Verifier failures should be fixed by narrow patches, not by weakening the contract.
