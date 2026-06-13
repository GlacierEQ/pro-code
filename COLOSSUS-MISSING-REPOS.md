# 🔴 COLOSSUS-MISSING-REPOS.md
## Living Gap Registry — GlacierEQ APEX Ecosystem

> **Doctrine:** Every missing repo is a sovereignty gap. Track it until it's closed.
> Update this file whenever a gap is identified or resolved. No silent omissions.
>
> Status legend: `⛔ MISSING` · `🔶 PARTIAL` · `🔄 IN-PROGRESS` · `✅ EXISTS`

Last reviewed: **June 2026**

---

## Strand 1 — Double Helix (Pro_Code)

| Repo / File | Status | Gap Description | Priority |
|---|---|---|---|
| `Pro_Code/CODER-SKILL.md` | ✅ EXISTS | Core identity + execution principles | — |
| `Pro_Code/STYLE.md` | ✅ EXISTS | Commit format, naming conventions | — |
| `Pro_Code/REPO-AUDIT.md` | ✅ EXISTS | Audit protocol | — |
| `Pro_Code/ECOSYSTEM.md` | ⛔ MISSING | Full ecosystem manifest listing every satellite repo, its role, and live/dead status | P1 |
| `Pro_Code/COLOSSUS-MISSING-REPOS.md` | ⛔ MISSING | Mirror of this file in the Double Helix strand — cross-strand gap visibility | P2 |
| `Pro_Code/MEMORY-ARCHITECTURE.md` | ⛔ MISSING | Documented spec for the 4-tier Aspen Grove memory stack (Supabase → Pinecone → Neo4j → Dropbox) | P1 |
| `Pro_Code/AGENT-PERSONAS.md` | ⛔ MISSING | Defined agent identity profiles with capability scoping per deployment context | P2 |

---

## Strand 2 — Spiral Engine (pro-code)

| Repo / File | Status | Gap Description | Priority |
|---|---|---|---|
| `pro-code/src/App.tsx` | ✅ EXISTS | Control surface UI with health check, per-button loading, worker telemetry | — |
| `pro-code/src/workers.ts` | ✅ EXISTS | 13-node worker mesh with live Nexus POST | — |
| `pro-code/src/memory.ts` | ✅ EXISTS | Aspen Grove local session memory | — |
| `pro-code/KNOWLEDGE.md` | ✅ EXISTS | Bridge doc with agent loading order | — |
| `pro-code/ci/` | ✅ EXISTS | 4 CI templates (typescript, python, go, release) | — |
| `pro-code/src/nexus.ts` | ⛔ MISSING | Dedicated Nexus API client module — currently inline fetch calls in App.tsx; should be extracted with typed request/response contracts | P1 |
| `pro-code/src/types.ts` | ⛔ MISSING | Shared type exports (`BtnKey`, `WorkerConfig`, `MemoryEntry`) currently scattered across files | P2 |
| `pro-code/src/App.test.tsx` | ⛔ MISSING | Unit tests for triggerNexus(), health-check disable logic, worker card rendering | P1 |
| `pro-code/src/workers.test.ts` | ⛔ MISSING | Unit tests for WorkersManager.execute() fallback path, getStats(), capability routing | P1 |
| `pro-code/e2e/` | ⛔ MISSING | Playwright or Cypress E2E suite — zero UI regression coverage currently | P2 |
| `pro-code/src/hooks/useNexusHealth.ts` | ⛔ MISSING | Extract health-check logic from App.tsx into a reusable hook | P3 |
| `pro-code/src/hooks/useWorkers.ts` | ⛔ MISSING | Extract worker state management from App.tsx | P3 |

---

## Satellite / Integration Repos

| Repo | Status | Gap Description | Priority |
|---|---|---|---|
| `GlacierEQ/nexus-api` | ⛔ MISSING | The `:8002` Nexus server itself — no public repo; if it exists locally only, it's a bus-factor-1 risk | P0 |
| `GlacierEQ/comet-agent` | 🔄 IN-PROGRESS | iOS WKWebView wrapper — auth cookie preservation bug filed; active development | P1 |
| `GlacierEQ/aspen-grove-memory` | ⛔ MISSING | Standalone memory sync service (referenced in memory.ts as localhost:8787) — not versioned | P1 |
| `GlacierEQ/apex-workers-runtime` | ⛔ MISSING | The Notion workers execution environment — workers.ts defines the mesh but the runtime server is untracked | P0 |
| `GlacierEQ/legal-case-automator` | ⛔ MISSING | Case analysis automation referenced in APEX doctrine — no repo found | P2 |
| `GlacierEQ/motion-generator-service` | ⛔ MISSING | Backend for motion-generator worker capability | P2 |
| `GlacierEQ/photo-video-pipeline` | ⛔ MISSING | Shared backend for photo-analyzer + video-processor workers | P2 |
| `GlacierEQ/mcp-connector-hub` | ⛔ MISSING | MCP session management service for mcp-manager worker | P1 |

---

## Critical Bus-Factor-1 Risks (P0)

These gaps represent single-point-of-failure scenarios where a repo or service exists
only locally and has no version-controlled backup:

1. **`nexus-api`** — The entire control surface is wired to `:8002`. If the local Nexus process is lost, all 4 Tier-1 triggers go dark. Version-control and containerize immediately.
2. **`apex-workers-runtime`** — 13 workers are defined but the execution environment is untracked. One disk wipe = full mesh outage.
3. **`aspen-grove-memory`** — `memory.ts` syncs to `localhost:8787`. If that service isn't committed anywhere, session memory persistence is fragile.

---

## Gap Closure Protocol

When closing a gap:
1. Create the repo/file
2. Update the Status column to `✅ EXISTS`
3. Add a link in the table
4. Commit this file with message: `docs(gap-registry): close [REPO-NAME]`

When discovering a new gap:
1. Add a row with `⛔ MISSING` and a clear description
2. Assign priority (P0 = breaks everything, P1 = sovereignty risk, P2 = quality debt, P3 = nice-to-have)
3. Commit with: `docs(gap-registry): register [REPO-NAME]`

---

*GlacierEQ APEX | Sovereign infrastructure doctrine | Maintained by: casey*
