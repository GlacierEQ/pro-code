# ⟁ pro-code — System Architecture

> Deep technical topology. Read this before touching the code.
> If this document and the code disagree, fix the code.

---

## The Shape of the System

```
┌─────────────────────────────────────────────────────────────────────┐
│                        OPERATOR (Browser)                           │
│                     pro-code React UI :5173                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │  HTTP + WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         nexus-api :8002                             │
│   Auth · CORS · Rate Limiting · Audit Trail · Pipeline Registry     │
└───────────────────┬──────────────────────────┬──────────────────────┘
                    │                          │
                    ▼                          ▼
┌───────────────────────────┐    ┌────────────────────────────────────┐
│  apex-workers-runtime     │    │   QUANTUM-SOVEREIGN Agent Layer    │
│         :8003             │    │                                    │
│  ┌─────────────────────┐  │    │  GHOST-EMBER   (Gemma 27B)         │
│  │ 13 Named Workers    │  │    │  IRON-TALON    (Llama 3.3 70B)     │
│  │ Capability Registry │  │    │  ORACLE-NET    (DeepSeek R1)       │
│  │ Health Monitor      │  │    │  ROOT-NEXUS    (Memory Sovereign)  │
│  │ Queue + Priority    │  │    │                                    │
│  └─────────────────────┘  │    │  // DARKSTAR — offline             │
└───────────────────────────┘    │  // awaiting activation            │
                                 └────────────────────────────────────┘
                    │                          │
                    └──────────┬───────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Memory Mesh                                 │
│                                                                     │
│   Aspen Grove (ROOT-NEXUS)   — long-term + episodic sync            │
│   Supermemory                — vector embedding + semantic recall   │
│   Neo4j                      — graph: entity · case · time edges    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Signal Flow — Button Press to Result

Every operator action follows a deterministic, fully traced path.

```
Operator click (TriggerBoard)
    │
    ├─ [0ms]     optimistic UI update (button → pending)
    ├─ [0ms]     trace_id generated (UUID v4)
    ├─ [0ms]     useWorkerDispatch.dispatch() called
    │
    ▼
nexus-api ingestion
    ├─ [50ms]    auth check
    ├─ [60ms]    pipeline registry lookup
    ├─ [70ms]    CORS + rate limit validation
    ├─ [80ms]    audit trail append (trace_id anchored)
    ├─ [90ms]    worker pool health check (requires ≥3 healthy)
    │
    ├─────────────────────────────────────────────────────┐
    ▼                                                     ▼
apex-workers-runtime                         QUANTUM-SOVEREIGN routing
    ├─ capability resolution                     ├─ intent classification
    ├─ worker health gate                        ├─ memory tier read
    ├─ priority queue placement                  ├─ context injection
    ├─ execution (Notion API, transforms)        ├─ model dispatch
    └─ coordinator aggregation                   └─ structured output
    │                                                     │
    └─────────────────────┬───────────────────────────────┘
                          ▼
                    Memory Write
                    ├─ ROOT-NEXUS → Aspen Grove diff-push
                    ├─ Supermemory → vector embed
                    └─ Neo4j → graph edge append
                          │
                          ▼
                    UI Resolution
                    ├─ React Query invalidation
                    ├─ optimistic state confirmed / rolled back
                    └─ audit log entry finalized
```

---

## Data Contracts

### Worker Dispatch Envelope
```typescript
interface WorkerDispatchEnvelope {
  worker_id: WorkerName;          // one of 13 canonical worker names
  capability: string;             // must match worker capability registry
  payload: Record<string, unknown>;
  priority: 'low' | 'normal' | 'high' | 'critical';
  trace_id: string;               // UUID v4 — propagates through entire chain
  timestamp: string;              // ISO 8601 UTC
  audit: {
    operator: string;
    trigger_source: string;
    pipeline_id?: string;
  };
}
```

### Agent Request Envelope
```typescript
interface AgentRequestEnvelope {
  agent: 'GHOST-EMBER' | 'IRON-TALON' | 'ORACLE-NET' | 'ROOT-NEXUS';
  intent: string;
  context: {
    memory_read?: MemoryTier[];
    documents?: string[];
    prior_trace?: string;
  };
  output_schema?: Record<string, unknown>;
  trace_id: string; // same trace from original trigger click
}
```

### Memory Entry Contract
```typescript
type MemoryTier = 'short-term' | 'long-term' | 'episodic';
type MemoryPriority = 'low' | 'medium' | 'high' | 'critical';

interface MemoryEntry {
  key: string;
  content: string;
  tier: MemoryTier;
  priority: MemoryPriority;
  created_at: string;       // ISO 8601
  updated_at: string;
  agent_source?: string;
  trace_id?: string;        // links back to originating trigger
  tags: string[];           // includes _sha7 fingerprint on critical writes
}
```

---

## Startup Sequence

```
1.  npm run dev  →  Vite starts :5173
2.  App mounts   →  nexus-api health probe fires (GET /health)
3.  Health OK    →  WorkersManager.register() for all 13 workers
4.  Registered   →  useWorkerHealth polling starts (5s interval)
5.  Memory init  →  Aspen Grove sync handshake
6.  UI ready     →  all trigger buttons enabled

If nexus-api is down at step 2:
  → degraded mode: UI renders, triggers disabled, memory read-only
  → health probe retries every 10s
  → banner: "NEXUS OFFLINE — operating in read-only mode"
```

---

## Error Propagation

No silent failures. Every error is structured and traced.

```typescript
// Every error returned by nexus-api:
interface NexusError {
  error_code: NexusErrorCode;   // never a raw string
  message: string;              // human-readable, operator-facing
  trace_id: string;
  recoverable: boolean;
  suggested_action?: string;
}

// Example:
{
  error_code: 'WORKER_CAPABILITY_MISMATCH',
  message: 'Worker case-analyzer does not support capability: batchTransform',
  trace_id: '7f3a9b2c-...',
  recoverable: true,
  suggested_action: 'Retry with coordinator worker or check capability registry'
}
```

---

## Performance Targets

| Stage | Target p50 | Alert Threshold |
|---|---|---|
| UI → nexus-api first byte | < 50ms | > 200ms |
| nexus-api → worker dispatch | < 100ms | > 500ms |
| Worker execution (simple) | < 2s | > 10s |
| Worker execution (complex) | < 10s | > 30s |
| Agent response (LLM round-trip) | < 5s | > 30s |
| Memory read (Aspen) | < 20ms | > 100ms |
| Memory write + sync | < 200ms | > 1s |
| Full pipeline (trigger → result) | < 30s | > 120s |

---

## Security Boundaries

```
[Browser] ──HTTPS──► [nexus-api] ──internal──► [workers-runtime]
                          │
                     Auth boundary
                     CORS enforcement
                     Rate limiting (per operator, per pipeline)
                     Request signing (HMAC on dispatch envelopes)

nexus-api NEVER exposes:
  • Notion API keys
  • Agent model credentials
  • Memory encryption keys
  • Worker internal state
  • Audit trail raw records

All secrets: environment variables only.
Never in source code. Never in commits. Never in logs.
```

---

## The Double Helix

`pro-code` and `Pro_Code` are intentionally separate — this mirrors how the best engineering organizations separate **product** from **craft**.

| Dimension | pro-code | Pro_Code |
|---|---|---|
| **What** | Running application | Engineering methodology |
| **Contains** | React UI, hooks, workers, agents | Playbooks, standards, CI templates, skill modules |
| **Changes when** | Features ship | Engineering practices evolve |
| **Read by** | Engineers building the UI | Engineers designing systems |
| **Drift signal** | PR merge frequency | Incident retrospective frequency |

Neither repo is complete without the other. Read both.
