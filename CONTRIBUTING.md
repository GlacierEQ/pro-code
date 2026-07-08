# Contributing to pro-code

> This is an engineering operating agreement, not a style guide.
> Read it before your first commit.

---

## The Standard

This codebase coordinates AI agents, processes legal evidence, and maintains persistent memory systems. The standard is not *"it works on my machine."* The standard is:

**It works correctly under adverse conditions and fails gracefully when it doesn't.**

That sentence is the whole philosophy. Everything below is a specific consequence of it.

---

## Before You Write Code

1. **Read ARCHITECTURE.md.** Know where your change lives in the signal flow.
2. **Identify failure modes first.** For every function: what breaks if this returns null? What if the network drops mid-execution? What if the worker pool is degraded?
3. **Check memory contracts.** If your code touches memory, verify the correct tier and priority. Writes to `long-term` that should be `short-term` are technical debt that silently grows.
4. **Understand the audit trail.** Every significant operation leaves a trace. If your change creates a new significant operation, it needs a trace entry.

---

## Commit Convention

```
type(scope): short imperative description

Why it changed (not what — the diff shows what).
What the failure mode was. What the new behavior guarantees.

Breaking: describe breaking change if any
Trace: trace-id if fixing a production incident
```

**Types:** `feat` `fix` `perf` `refactor` `test` `docs` `ci` `chore`

**Scopes:** `workers` `memory` `triggers` `agents` `ui` `api` `auth` `audit`

**Good commits:**
```
feat(workers): add exponential backoff with jitter to all dispatch retries

Workers were failing silently on transient Notion API 429s.
Now retries 3x with 200ms base delay, 2x multiplier, ±50ms jitter.
All retry attempts are audit-logged with attempt count.

fix(memory): resolve race condition in concurrent short-term writes

Two simultaneous critical-priority writes were silently dropping one.
Added write queue with FIFO guarantee per key. No data loss in load test.

perf(triggers): debounce rapid successive trigger clicks at 300ms

Operators were accidentally firing duplicate pipelines on double-click.
```

**Bad commits (block these in review):**
```
fix stuff
updated things
WIP
final
final2
final_FINAL
```

---

## Code Standards

### TypeScript
- **Strict mode always.** `"strict": true` in tsconfig. No `any` except documented test mocks.
- **Explicit return types on all exported functions.** The signature is the contract.
- **Named exports over default exports.** Grep-ability matters.
- **Discriminated unions for error types** — never error strings.
- **Branded types for IDs** — `type TraceId = string & { readonly __brand: 'TraceId' }`

### React
- **Custom hooks for all data-fetching.** No raw `fetch` in components.
- **Optimistic updates for all trigger actions.** Users should never wait for server round-trips to see feedback.
- **Error boundaries around all agent and worker panels.** One failing panel should never crash the board.
- **React Query for server state.** Local useState only for ephemeral UI state.

### Error Handling
- **Every async function has a typed error path.** `Result<T, E>` pattern or explicit `try/catch` with typed catch.
- **No swallowed errors.** `catch (e) {}` is forbidden. Either handle it or re-throw with context.
- **User-facing errors are always actionable.** Never "Something went wrong." Always: what happened + what to do.

---

## Pull Request Protocol

### Preflight (all must pass before opening PR):
```bash
npm run typecheck   # zero TypeScript errors
npm run lint        # zero ESLint warnings
npm run test        # all tests green
npm run build       # clean production build
```

### PR description must answer five questions:
1. **What changed?** — one sentence
2. **Why?** — the problem being solved, not the solution
3. **How to test it?** — exact steps a reviewer can follow
4. **What failure modes did you consider?** — at least two
5. **Memory/audit impact?** — does this change what gets written to memory or the audit trail?

A PR without answers to these five questions gets returned for revision before review.

---

## Testing Philosophy

**Unit test the contracts, not the implementations.**

The contract of `dispatchWorker` is: given a valid envelope, it returns a `WorkerResponse`. Given an invalid envelope, it throws a typed `WorkerError`. Test the contract. Don't test internal variable names.

**Test failure modes explicitly.** For every happy-path test, there must be at least one failure-path test.

```typescript
describe('dispatchWorker', () => {
  it('returns WorkerResponse for valid envelope', async () => { /* ... */ });
  it('throws WORKER_OFFLINE when worker health is degraded', async () => { /* ... */ });
  it('throws CAPABILITY_MISMATCH when capability not in registry', async () => { /* ... */ });
  it('retries 3x with backoff before throwing on network failure', async () => { /* ... */ });
  it('preserves trace_id through retry chain', async () => { /* ... */ });
});
```

**The ratio rule:** aim for 1 failure-path test per 1 happy-path test. A codebase with no failure-path tests doesn't know what it does wrong. A codebase with only happy-path tests is a liability dressed as coverage.

---

## The Easter Egg Tradition

This codebase rewards engineers who read deeply.

Rule: Easter eggs must be (1) discoverable through careful reading, (2) never disruptive to operations, (3) always delightful. See EASTER_EGGS.md for the current collection and instructions for adding your own.
