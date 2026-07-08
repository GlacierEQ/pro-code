# Signal Flow — Runtime Trace Documentation

> A millisecond-level walkthrough of what happens when an operator presses a trigger.
> This is the ground truth. When the code and this document disagree, fix the code.

---

## Example: AEON-777 Forensic Pipeline

Operator presses the **AEON-777 Forensic Pipeline** trigger.

---

### Phase 1: UI Response (0–50ms)

```
[click event fires on TriggerBoard]
  ├─ button state → 'pending' (spinner visible, disabled)
  ├─ optimistic log entry appended: "AEON-777: INITIATING"
  ├─ trace_id generated: UUID v4
  ├─ timestamp recorded: ISO 8601 UTC
  └─ useWorkerDispatch.dispatch() called with envelope:
       {
         worker_id: 'coordinator',
         capability: 'runPipeline',
         payload: { pipeline: 'aeon777' },
         priority: 'high',
         trace_id: <generated>,
         timestamp: <now>,
         audit: { operator: <session>, trigger_source: 'TriggerBoard' }
       }
```

---

### Phase 2: nexus-api Ingestion (50–150ms)

```
POST http://localhost:8002/api/v1/trigger_aeon777
Headers:
  Content-Type: application/json
  X-Trace-Id: <trace_id>
  X-Operator-Id: <session_id>

nexus-api processing:
  ├─ validates auth token
  ├─ appends to audit trail (append-only, trace_id anchored)
  ├─ validates pipeline: 'aeon777' in registry
  ├─ checks worker pool health (requires ≥ 3 healthy workers)
  │   └─ if < 3 healthy: returns 503 + degraded_workers array
  ├─ creates pipeline execution record
  └─ dispatches to apex-workers-runtime with priority: 'high'
```

---

### Phase 3: Worker Execution (150ms–10s)

```
apex-workers-runtime receives pipeline task:
  ├─ resolves required workers: [case-analyzer, analyst, creator]
  ├─ for each worker:
  │   ├─ capability check: 'analyzeCase' in worker.capabilities?
  │   ├─ health check: worker.status === 'healthy'?
  │   ├─ queue placement: insert at priority 'high'
  │   ├─ execution: worker.capabilities.analyzeCase(payload)
  │   └─ sync: caseSync / dataIngestionSync / contentSync
  ├─ coordinator worker aggregates results
  └─ structured output assembled: { evidence_refs, case_ids, doc_ids }
```

---

### Phase 4: Agent Routing (parallel with Phase 3)

```
Routed to GHOST-EMBER (Gemma 27B — forensic synthesis):
  Request envelope:
    {
      agent: 'GHOST-EMBER',
      intent: 'consolidate_evidence_chain',
      context: {
        memory_read: ['long-term', 'episodic'],
        documents: <doc_ids from analyst worker>,
        prior_trace: <previous AEON-777 session if exists>
      },
      trace_id: <same trace from Phase 1>
    }

  GHOST-EMBER response:
    {
      evidence_chain: [...],
      hash_verification: { verified: true, method: 'SHA-256' },
      custody_documentation: [...],
      audit_event: { agent: 'GHOST-EMBER', action: 'consolidated', trace_id: ... }
    }
```

---

### Phase 5: Memory Write

```
ROOT-NEXUS receives audit_event from GHOST-EMBER:
  ├─ long-term tier:  case timeline entry (priority: high)
  ├─ episodic tier:   AEON-777 full session record (priority: high)
  ├─ Aspen Grove:     diff-push sync (async, non-blocking)
  ├─ Supermemory:     vector embed of key findings + case ref
  └─ Neo4j:           edges: evidence → case → agent → timestamp
```

---

### Phase 6: UI Resolution

```
nexus-api streams status events to UI:
  ├─ [workers_dispatched]  → log: "Workers assigned"
  ├─ [workers_complete]    → log: "Evidence gathered"
  ├─ [agent_routing]       → log: "GHOST-EMBER synthesizing"
  ├─ [agent_complete]      → log: "Chain consolidated"
  ├─ [memory_written]      → log: "Session recorded"
  └─ [pipeline_complete]   → button: 'ready', result panel opens

On timeout (30s without completion):
  → button returns to 'ready'
  → warning: "Pipeline still running — check audit trail for trace <trace_id>"
  → trace preserved; operator can query status manually
```

---

## Error Recovery Matrix

| Failure Point | Error Code | UI Response | Recovery Path |
|---|---|---|---|
| nexus-api unreachable | `NEXUS_OFFLINE` | Banner, triggers disabled | Auto-probe every 10s |
| Worker pool degraded | `WORKER_DEGRADED` | Warning + degraded workers list | Route to backup workers |
| Agent timeout | `AGENT_TIMEOUT` | Partial results shown | Operator can retry agent step |
| Memory write fails | `MEMORY_WRITE_FAILED` | Silent retry ×3, then audit warning | Offline queue, sync on reconnect |
| Pipeline not found | `PIPELINE_NOT_FOUND` | Error shown, trace logged | Verify pipeline registry |
| Auth failure | `AUTH_INVALID` | Session reset prompt | Re-authenticate |
| Capability mismatch | `CAPABILITY_MISMATCH` | Specific error + suggested worker | Check capability registry |

---

## Trace ID Lifecycle

The `trace_id` generated in Phase 1 (a single UUID) propagates through every layer:

```
Generated:    TriggerBoard click handler
Propagated:   nexus-api request header
Anchored:     audit trail append (immutable)
Forwarded:    workers-runtime dispatch payload
Inherited:    each worker's execution context log
Passed:       agent request envelope
Returned:     agent response audit_event
Written:      ROOT-NEXUS memory entry .trace_id
Synced:       Aspen Grove record
Indexed:      Neo4j edge attribute
```

Every artifact — memory entry, audit record, Notion update, agent response — traces back to the exact button press that caused it.

This is not accidental. This is a deliberate design decision about **operator accountability and incident reconstruction**.

Given a trace_id, you can reconstruct every action the system took in response to a single click. No black boxes.
