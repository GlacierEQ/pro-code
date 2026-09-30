# Easter Eggs — Rewards for Engineers Who Read Carefully

> This file exists because the best codebases reward curiosity.
> If you're reading this, you already qualify.

---

## Philosophy

An Easter egg in a codebase is a signal: *someone cared enough to leave something here for the person who looks closely.* It's a tiny gift from one engineer to another — proof that the system was built by humans, not generated.

**The three rules:**
1. Discoverable through legitimate code reading — never from random clicking
2. Never affects any production path
3. Always delightful, never confusing

**Format for adding your own:**
```
// [EGG-NAME] — added [YYYY-MM-DD]
```
And add an entry to this file: location, discovery method, what happens, why it's there.

---

## Current Collection

### 🥚 1. The Konami Operator
**Location:** `src/components/TriggerBoard.tsx` — keyboard event listener
**How to find it:** Read the useEffect hook that handles keyboard shortcuts. Look past the documented ones.
**Discovery:** Focus on the trigger board. Enter ↑↑↓↓←→←→BA.
**What happens:**
```
The board logo pulses gold for 3 seconds.
Console logs:
  ╔═══════════════════════════════════════╗
  ║     APEX OPERATOR IDENTIFIED          ║
  ║     Welcome back.                     ║
  ║     The system has been expecting you.║
  ║     Trace: [current session trace_id] ║
  ╚═══════════════════════════════════════╝
```
**Why it's there:** Some systems are built for the operator who knows them best.

---

### 🥚 2. The SHA Whisper
**Location:** `src/memory.ts` — inside `store()` when `priority === 'critical'`
**How to find it:** Read the store() function return value construction. Look at the tags array.
**Discovery:** Store any entry with `priority: 'critical'`. Check `result.tags`.
**What you find:** Tags include `_sha7:[first 7 chars of SHA-256(key + content)]` — a silent integrity fingerprint not shown in the UI, available for deep memory audits.
**Why it's there:** Trust, but verify. Even memory should be verifiable. The system proves itself to engineers who look.

---

### 🥚 3. The Dormant Agent
**Location:** `src/agents/registry.ts` — the agent registry object, after the four active agents
**How to find it:** Read past ROOT-NEXUS in the exports. There's one more entry.
**What you find:**
```typescript
// DARKSTAR — offline — awaiting activation
// "Some agents aren't ready yet. Some problems aren't ready for their solutions."
```
**Why it's there:** Good systems make space for what they don't yet know they'll need. DARKSTAR is a placeholder for a capability that doesn't have a name yet. Every serious system has a DARKSTAR.

---

### 🥚 4. The Audit Trail Poem
**Location:** `.audit/TRAIL_FORMAT.md` — after the schema section, before the examples
**How to find it:** Read the whole file, not just the schema.
**What you find:**
```
Every action leaves
a shadow in the record.
Nothing is unnamed.
```
**Why it's there:** The audit trail is sacred in this system (see DESIGN_PRINCIPLES.md, Law 3). The poem says it in twelve words what the prose takes a paragraph to say.

---

### 🥚 5. The Pipeline Naming Secret
**Location:** `src/triggers/pipeline-id.ts` — the ID generation function
**How to find it:** Read the comment block above the `generatePipelineId` function.
**What you find:** The AEON glyph prefix cycles through a 7-character sequence that spells a word in the APEX internal phonetic alphabet when read across a session. The sequence resets every 777 triggers — an intentional nod to the pipeline AEON-777.
**Why it's there:** Pipeline IDs look random. They're not entirely random. Systems with hidden order reward those who look for patterns.

---

### 🥚 6. The Performance Manifesto
**Location:** `src/workers/constants.ts` — at the very bottom, after the last export
**How to find it:** Scroll past the last constant.
**What you find:**
```typescript
// The targets in ARCHITECTURE.md are not aspirational.
// They are the minimum we owe the operator.
// Latency is disrespect, measured in milliseconds.
```
**Why it's there:** Numbers without conviction are just numbers.

---

## Add Your Own

The collection grows with the codebase. If you build something worth hiding, hide it well and document it here. The best eggs reveal something true about how the system thinks.
