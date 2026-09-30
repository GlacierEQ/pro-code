---
description: Keep private-repository CI off private GitHub-hosted runner budgets and route verification through the APEX public action face.
---

# CI Deploy Fleet

## Governing invariant

**Private repositories do not run automatic GitHub-hosted CI.**

A reusable workflow called from a private repository is still private Actions execution for billing/limits. Therefore `push` and `pull_request` workflows in private repositories must not call `ubuntu-latest` or the reusable public runner as their normal verification path.

Automatic verification executes from:

`GlacierEQ/public-actions-runner-host`

The public action face must:

1. receive a bounded action job;
2. mint short-lived repository-scoped credentials through OIDC/Keymaster;
3. checkout the exact private source SHA without persisting credentials;
4. execute the catalog-approved validator in isolation;
5. verify the workload/result relationship;
6. publish an immutable detailed result to the private control plane; and
7. revoke workload and control tokens.

Private `.github/workflows/ci.yml` files are retained only as **manual recovery** surfaces using `workflow_dispatch`.

## Fleet repair

Use the canonical installer:

```bash
ci/templates/setup-repo-ci.sh repo-a repo-b repo-c
```

Preview first when operating on an unfamiliar repository:

```bash
ci/templates/setup-repo-ci.sh repo-a repo-b --dry-run
```

The installer now creates or replaces only a `workflow_dispatch` recovery workflow. It deliberately does **not** add automatic private `push`/`pull_request` triggers.

## Verification rule

A private repository is considered migrated only when all of the following hold:

- its automatic private hosted-runner trigger is absent;
- its branch protection does not depend on a retired private check, or the dependency has an approved replacement;
- the public action catalog authorizes the repository/action;
- Keymaster can mint only the bounded repository token required for the action;
- an exact-SHA public execution completes; and
- the immutable private result receipt matches that SHA.

## Proven reference

`GlacierEQ/computer-user` established the reference path on 2026-08-11: the public action face validated exact private SHA `d2a7e48a744a36c50da8960a11aafef563a8cc97`, with 130 bounded-Smithery tests passing and Ruff clean, while the corresponding private automatic workflows were retired without spawning private Actions runs.
