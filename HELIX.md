# pro-code Helix Activation

This repo is activated as the runtime strand of the GlacierEQ Double Helix.

## Canonical Pointers

- Repo profile: `.apex/repo-profile.json`
- Strand declaration: `.helix/strand.json`
- Phase 1B contract: `.helix/phase-1b-contract.md`
- Drift rules: `.audit/drift-rules.md`
- Verifier: `tools/helix_verify.py`
- Symlink map: `.helix/symlink-map.json`

## Paired Strand

- Doctrine strand: `GlacierEQ/Pro_Code`

## Verify

```bash
python tools/helix_verify.py \
  --expected-repo GlacierEQ/pro-code \
  --expected-role runtime_strand
```
