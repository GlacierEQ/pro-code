# ⟁ pro-code — APEX Control Surface

React and Vite human control plane for the GlacierEQ APEX ecosystem.

## Architecture

`pro-code` dispatches to a configurable Nexus API, which may proxy reviewed work to the workers runtime. The UI registry currently contains **15 workers**; the displayed count is derived from the registry rather than maintained separately.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure `VITE_NEXUS_BASE_URL` when Nexus is not available through same-origin routes. Configure `VITE_CASE_ID` or supply a case ID per request; dispatch fails closed without one.

## Worker dispatch

`src/workers.ts` sends a typed, versioned envelope containing case, trace, task, idempotency, priority, constraints, producer, capability, and parameter fields. A deployment can inject auth and detached-signature hooks without embedding credentials in the envelope.

All UI-originated work carries these immutable constraints:

- human review is required;
- external actions are forbidden.

Offline, rejected, and malformed runtime responses remain failures. The UI reports success only when Nexus explicitly acknowledges success and supplies a result. See [the dispatch contract](docs/dispatch-contract.md).

## Workers

| Group | Workers |
|---|---|
| Core intelligence | strategist, coordinator, analyst, creator |
| Data and memory | database-crawler, memory-specialist |
| Execution | python-executor, api-manager, mcp-manager |
| Media | photo-analyzer, video-processor |
| Case drafting and analysis | case-analyzer, motion-generator |
| AI orchestration | ai-executor, automation-orchestrator |

The case and motion workers may analyze or generate drafts. They may not file, serve, publish, or release evidence.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

**Double Helix strand:** [Pro_Code](https://github.com/GlacierEQ/Pro_Code) (engineering brain) ↔ `pro-code` (operator UI).
