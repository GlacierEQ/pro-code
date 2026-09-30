# Helix Drift Rules

These rules define conditions that should block promotion from Phase 1B.

## Identity Drift

Block when:

- `.apex/repo-profile.json` `repo` does not match the repository under verification.
- `.apex/repo-profile.json` `helix_role` does not match the expected role.
- `.helix/strand.json` `strand_type` does not match the expected role family.
- `canonical_name` conflicts with the repository name.

## Pairing Drift

Block when:

- Doctrine strand does not point to the runtime strand.
- Runtime strand does not point to the doctrine strand.
- A paired repository is available locally but does not point back.
- `paired_strand` disagrees with `paired_runtime_strand` or `paired_doctrine_strand`.

## Substrate Drift

Block when:

- Required Phase 1A substrate files are missing.
- Required Phase 1B enforcement files are missing.
- Schema files are invalid JSON.
- Hidden JSON files are invalid JSON.

## Security Drift

Block when hidden substrate contains likely raw secrets, tokens, private keys, or credential files.

Allowed patterns:

- `secret_ref`
- `vault_ref`
- `evidence_id`
- `sha256`
- pointer references to external systems

Blocked patterns include common raw token prefixes, private-key headers, `.env` contents, and inline credential assignments.

## Review Discipline

Do not resolve drift by deleting checks. Fix the underlying substrate or document a narrow exception in `.audit/` with reviewer approval.
