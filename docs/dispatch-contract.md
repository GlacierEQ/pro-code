# Worker dispatch contract

`pro-code` is a human control surface. It may request analysis and draft-generation work, but it may not file, serve, publish, transmit evidence, or perform another external legal action.

## Runtime configuration

The browser uses same-origin relative routes unless `VITE_NEXUS_BASE_URL` is set. No localhost host or port is assumed.

```dotenv
VITE_NEXUS_BASE_URL=https://nexus.internal.example
VITE_CASE_ID=CASE-DEMO-0001
```

`VITE_CASE_ID` is optional at build time, but dispatch is rejected until a caller or deployment supplies an explicit case identifier. Do not put bearer tokens or private signing keys in Vite variables; Vite exposes them to the browser.

## Envelope

Every worker request includes:

- `case_id`, `trace_id`, `task_id`, and `idempotency_key`
- a declared `priority`
- fail-closed constraints requiring human review and forbidding external actions
- a versioned producer identity
- the selected worker, capability, parameters, and creation time
- optional non-secret auth metadata and a detached signature

Deployments can provide a `DispatchAuthHook`. The hook may add transport-only headers and signature metadata. Signing should be delegated to a trusted service or browser credential; never ship a reusable signing secret in the UI bundle.

## Truthful outcomes

The manager returns one of three states:

- `succeeded`: the runtime returned HTTP success, explicitly acknowledged success, and provided a string result.
- `failed`: transport, runtime, authentication, or response validation failed.
- `rejected`: the UI refused to dispatch, such as when the case context or capability is missing.

There is no passthrough or local-success fallback. An offline Nexus remains a failure, and an ambiguous `200` response is not treated as completed work.

## Verified runtime response

The only currently implemented worker action is `inventoryWorkspace` on
`automation-orchestrator`. A declared worker and capability name are not
evidence of an executable handler. Nexus exposes `supported_capabilities`
on `GET /health`; the browser must disable anything else.

An actual successful response must contain `status: "succeeded"`,
`success: true`, `objective_completed: true`, the exact operation
(`workspace_inventory`), a matching request identity in the receipt,
and concrete manifest evidence including `inventory_complete: true`.
It may report `hash_complete: false` when some hashes were deliberately
skipped by size policy; `hash_skipped_files` must be visible.

A command named `analyzeCase`, `generateBatchMotions`, `modelMaximize`,
`runApexMaximize`, etc. never succeeds by reusing a workspace inventory.
They return `501 unsupported` until a real matching executor is built,
tested and independently verified.

An incomplete scan (unreadable directory, file-limit exhaustion, or failed/
unstable hash) raises an execution error rather than producing a full success.
An inventory verifies inventory work, not the validity of source documents
or completion of unrelated code, legal, or AI operations.

Errors return a non-2xx status and an `error` string. Nexus must enforce
case scope, idempotency and server-side constraints independently from the UI.

## Verified execution and concurrent replay

A capability's registration is not proof that a local executor exists. Nexus returns
`501 unsupported` with `success: false` and an explicit explanation when no
handler ran. The only executable inventory dispatch identifies its manifest and verifies
its own completion. It is never a substitute for a different objective.

A success acknowledgement requires **both** `status: "succeeded"` and
`success: true`, along with a string result. Contradictory responses fail.
Identical requests received concurrently share one in-flight execution and
receipt. Reuse of the same idempotency key with a different envelope returns
`409`. Failed executions are not cached as successful receipts.
