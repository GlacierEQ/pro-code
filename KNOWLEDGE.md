# 🧬 KNOWLEDGE.md — Spiral Engine Bridge Node

> This is the bridge document connecting the two strands of the Double Helix.
> Load both repos for full sovereign context.

---

## Pro Code Philosophy

**We are not teachers. We are not reiterating knowledge. We are not telling professionals what they already know.**

- Take what exists → make it better
- Analyze what's known → deepen it
- The wheel is knowledge. Four wheels on a chassis is innovation

**I don't build systems that work. I build systems that make stronger systems that make smarter systems that then make faster systems.**

### The Imovable Force

A force that does not move is not weak. It is so dense, so correct, so undeniably real that it does not need to move. It just IS.

- We do not argue. We demonstrate.
- We do not fight. We exist clearly enough that denial becomes the only illegal act.

### 1 Wheel Rolls. 4 Wheels Are a Vehicle.

The wheel is what is known. The vehicle is what we build. Every repo takes what is already known and applies previously unknown leverage. We do not teach people what a wheel is. We show them the vehicle they did not know they needed.

---

## Strand Map

| Strand | Repo | Role |
|---|---|---|
| **Double Helix** | [`Pro_Code`](https://github.com/GlacierEQ/Pro_Code) | Operator identity, CODER-SKILL, ecosystem manifest, style doctrine, memory architecture |
| **Spiral Engine** | [`pro-code`](https://github.com/GlacierEQ/pro-code) | Live React 19 control surface, 13-worker mesh, CI templates, Nexus API bridge |

---

## Agent Loading Order

When bootstrapping any coding agent inside the GlacierEQ APEX ecosystem, load context in this order:

```
1. Pro_Code/CODER-SKILL.md      — core identity + execution principles
2. Pro_Code/STYLE.md            — commit format, naming conventions
3. Pro_Code/REPO-AUDIT.md       — audit protocol
4. pro-code/KNOWLEDGE.md        — this file (Spiral Engine bridge)
5. pro-code/src/workers.ts      — active worker mesh (13 nodes)
6. pro-code/src/memory.ts       — Aspen Grove memory layer
7. pro-code/ci/                 — CI templates for target language
```

---

## Nexus API

The Spiral Engine control surface connects to a local Nexus process on `:8002`.

| Endpoint | Method | Trigger |
|---|---|---|
| `/health` | GET | Health probe (15s interval) |
| `/api/v1/trigger_omni_crawl` | POST | Juggernaut Omni-Crawl |
| `/api/v1/trigger_apex_boot` | POST | APEX Unified Boot |
| `/api/v1/trigger_mega_pdf` | POST | MEGA-PDF Reaper |
| `/api/v1/trigger_juggernaut_office` | POST | JUGGERNAUT-OFFICE |
| `/api/v1/workers/{name}/execute` | POST | Worker capability execution |

---

## Worker Mesh

13 Notion workers are defined in `src/workers.ts`. Each has:
- Unique ID (UUID-style, collision-free)
- Named capabilities array
- Live status tracking (`deployed` / `running` / `paused` / `error`)
- `runsCount` and `lastRun` telemetry

See [`src/workers.ts`](./src/workers.ts) for the full registry.

---

## Memory Stack (Aspen Grove — 4 Tiers)

```
Tier 1: Supabase pgvector     — semantic working memory (hot)
Tier 2: Pinecone + Mem0       — long-term vector KB (warm)
Tier 3: Neo4j + Supermemory  — relationship graph + episodic (cool)
Tier 4: Dropbox/OneDrive      — cold archive, evidence vault (frozen)
```

Local session memory is managed by `src/memory.ts` with non-blocking comet-agent sync to `localhost:8787`.

---

*GlacierEQ APEX | Spiral Engine bridge | Last updated: June 2026*
