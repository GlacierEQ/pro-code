# ⟁ pro-code — APEX Control Surface

> React+Vite dashboard for the GlacierEQ APEX sovereign ecosystem.
> The human-facing control plane for 13 Notion Workers, QUANTUM-SOVEREIGN agents, and pipeline triggers.

---

## Architecture

```
pro-code (:5173)  →  nexus-api (:8002)  →  apex-workers-runtime (:8003)
   │                     │                        │
   ├─ Trigger buttons    ├─ Health probe          ├─ strategist
   ├─ WorkersManager     ├─ Pipeline triggers     ├─ coordinator
   ├─ MemorySystem       ├─ Worker proxy          ├─ analyst
   ├─ useWorkerHealth    └─ CORS + logging        ├─ creator
   └─ useWorkerDispatch                            ├─ database-crawler
                                                   ├─ memory-specialist
                                                   ├─ python-executor
                                                   ├─ api-manager
                                                   ├─ mcp-manager
                                                   ├─ photo-analyzer
                                                   ├─ video-processor
                                                   ├─ case-analyzer
                                                   └─ motion-generator
```

## Quick Start

```bash
npm install
npm run dev          # → http://localhost:5173
```

Requires [nexus-api](https://github.com/GlacierEQ/nexus-api) running on `:8002`.

## Trigger Endpoints

| Button | Endpoint | Pipeline |
|---|---|---|
| ⟁ QUANTUM-SOVEREIGN Boot | `/api/v1/trigger_quantum_sovereign` | Full agent mesh activation |
| 🚀 APEX Unified Boot | `/api/v1/trigger_apex_boot` | All-pillar boot sequence |
| 🎤 Stealth Sonic → GHOST-EMBER | `/api/v1/trigger_stealth_sonic` | Audio forensics pipeline |
| 🎯 AEON-777 Forensic Pipeline | `/api/v1/trigger_aeon777` | Evidence consolidation |
| ⚖️ Full Forensic Audio + Motions | `/api/v1/trigger_forensic_pipeline` | Legal motion generation |
| 🕷 Juggernaut Omni-Crawl | `/api/v1/trigger_omni_crawl` | Web intelligence harvest |
| 📄 MEGA-PDF Reaper | `/api/v1/trigger_mega_pdf` | Bulk document extraction |
| 📁 JUGGERNAUT-OFFICE | `/api/v1/trigger_juggernaut_office` | Office document processing |

## Workers

13 Notion Workers managed by `WorkersManager` in `src/workers.ts`:

| Worker | Capabilities |
|---|---|
| strategist | analyzeStrategy, createStrategyTask, strategyReviewSync |
| coordinator | assignTask, executeTask, taskQueueStatusSync |
| analyst | analyzeData, synthesizeData, dataIngestionSync |
| creator | generateContent, generateReport, contentSync |
| database-crawler | consolidatePages, crawlDatabase, pageSync |
| memory-specialist | organizeMemory, extractMemory, memorySync |
| python-executor | executePython, connectNotionAI, pythonScriptSync |
| api-manager | executeAPI, configureRateLimiter, apiCallSync |
| mcp-manager | connectMCP, manageMCPSession, mcpSync |
| photo-analyzer | analyzePhoto, processBatchPhotos, photoSync |
| video-processor | processVideo, processBatchVideos, videoSync |
| case-analyzer | analyzeCase, consolidateCases, caseSync |
| motion-generator | generateMotion, generateBatchMotions, motionSync |

## QUANTUM-SOVEREIGN Agents

| Agent | Model | Role |
|---|---|---|
| GHOST-EMBER | Gemma 27B | Audio forensics + legal analysis |
| IRON-TALON | Ollama MCP | Voice fingerprinting + orchestration |
| ORACLE-NET | Perplexity | Federal statute research |
| ROOT-NEXUS | Aspen Grove | Persistent memory + GitHub sync |

## Memory System

`src/memory.ts` — short-term / long-term / episodic memory with comet-agent sync.

```typescript
import { memory } from './memory';
await memory.store('key', 'content', 'long-term', 'high');
const entry = await memory.get('key');
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | TypeScript check + production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type checking |

---

**Part of the [GlacierEQ APEX](https://github.com/GlacierEQ) ecosystem.**
**Double Helix strand:** [Pro_Code](https://github.com/GlacierEQ/Pro_Code) (brain) ↔ pro-code (UI)
