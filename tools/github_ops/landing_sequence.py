"""Resumable multi-step landing coordination using the existing consented journal.

This module performs no provider write. A host invokes its normal consented
connector AFTER receiving a READY step and reserving it through arm().
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from .landing_journal import (
    LandingJournal, LandingStateError, canonical, fingerprint, timestamp,
    validated_intent,
)

SCHEMA = "glaciereq.github-landing-sequence.v1"
CONFIRMED = frozenset({"VERIFIED", "ALREADY_SATISFIED"})
UNCERTAIN = frozenset({"ARMED", "ATTEMPTED", "UNRESOLVED"})
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")


def validate_manifest(value: object) -> dict:
    """Validate a bounded, dependency-ordered manifest without side effects."""
    if not isinstance(value, dict) or set(value) != {"schema", "plan_id", "steps"}:
        raise LandingStateError("manifest requires exactly schema, plan_id and steps")
    if value["schema"] != SCHEMA:
        raise LandingStateError("unsupported landing sequence schema")
    plan_id = value["plan_id"]
    if not isinstance(plan_id, str) or not IDENTIFIER.fullmatch(plan_id):
        raise LandingStateError("invalid plan_id")
    steps = value["steps"]
    if not isinstance(steps, list) or not 1 <= len(steps) <= 200:
        raise LandingStateError("steps must be a list of 1 to 200 entries")
    names = set()
    config = {}
    for step in steps:
        if not isinstance(step, dict) or set(step) != {"id", "depends_on", "intent"}:
            raise LandingStateError("each step requires exactly id, depends_on and intent")
        key = step["id"]
        if not isinstance(key, str) or not IDENTIFIER.fullmatch(key) or key in names:
            raise LandingStateError("step IDs must be valid and unique")
        dependencies = step["depends_on"]
        if (not isinstance(dependencies, list)
                or any(not isinstance(dep, str) or not IDENTIFIER.fullmatch(dep) for dep in dependencies)
                or len(set(dependencies)) != len(dependencies)):
            raise LandingStateError(f"invalid or repeated dependencies for {key}")
        validated_intent(step["intent"])
        # Check all nested values can be deterministically represented.
        fingerprint(step["intent"])
        names.add(key)
        config[key] = tuple(dependencies)
    for key, dependencies in config.items():
        if any(dep not in names for dep in dependencies):
            raise LandingStateError(f"unknown prerequisite for {key}")
    visiting, visited = set(), set()

    def visit(key):
        if key in visiting:
            raise LandingStateError("dependency cycle detected")
        if key in visited:
            return
        visiting.add(key)
        for dep in config[key]:
            visit(dep)
        visiting.remove(key)
        visited.add(key)

    for key in config:
        visit(key)
    fingerprint(value)
    return value


class LandingSequence:
    """Atomic install, resumable inspection, and dependency-aware arm."""

    def __init__(self, database: str | Path):
        self.journal = LandingJournal(database)
        with self.journal._connect() as db:
            db.execute("""
                CREATE TABLE IF NOT EXISTS landing_sequences (
                    plan_id TEXT PRIMARY KEY,
                    manifest_json TEXT NOT NULL,
                    manifest_sha256 TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)

    def install(self, manifest: dict) -> dict:
        manifest = validate_manifest(manifest)
        plan_id = manifest["plan_id"]
        blob, sha = canonical(manifest), fingerprint(manifest)
        with self.journal._connect() as db:
            existing = db.execute(
                "SELECT manifest_sha256 FROM landing_sequences WHERE plan_id=?",
                (plan_id,),
            ).fetchone()
            if existing:
                if existing["manifest_sha256"] != sha:
                    raise LandingStateError("sequence identity is immutable; choose a new plan")
                return {"plan_id": plan_id, "manifest_sha256": sha, "created": False}
            other_steps = db.execute(
                "SELECT COUNT(*) FROM steps WHERE plan_id=?", (plan_id,)
            ).fetchone()[0]
            if other_steps:
                raise LandingStateError("plan ID already contains independently planned steps")
            db.execute(
                "INSERT INTO landing_sequences VALUES (?,?,?,?)",
                (plan_id, blob, sha, timestamp()),
            )
            for step in manifest["steps"]:
                intent, step_id = step["intent"], step["id"]
                db.execute(
                    """INSERT INTO steps
                    (plan_id,step_id,intent_json,intent_sha256,state,changed_at)
                    VALUES (?,?,?,?,?,?)""",
                    (plan_id, step_id, canonical(intent), fingerprint(intent), "PLANNED", timestamp()),
                )
                self.journal._event(
                    db, plan_id, step_id, "PLANNED",
                    {"intent_sha256": fingerprint(intent), "operation": intent["operation"]},
                )
        return {"plan_id": plan_id, "manifest_sha256": sha, "created": True}

    def manifest(self, plan_id: str) -> dict:
        with self.journal._read() as db:
            row = db.execute(
                "SELECT manifest_json FROM landing_sequences WHERE plan_id=?",
                (plan_id,),
            ).fetchone()
        if row is None:
            raise LandingStateError(f"unknown sequence: {plan_id}")
        return json.loads(row["manifest_json"])

    def status(self, plan_id: str) -> dict:
        """One read-only snapshot: ready, recovery, blocked and completed work."""
        with self.journal._read() as db:
            meta = db.execute(
                "SELECT manifest_json,manifest_sha256 FROM landing_sequences WHERE plan_id=?",
                (plan_id,),
            ).fetchone()
            if meta is None:
                raise LandingStateError(f"unknown sequence: {plan_id}")
            manifest = json.loads(meta["manifest_json"])
            rows = {
                row["step_id"]: dict(row)
                for row in db.execute("SELECT * FROM steps WHERE plan_id=?", (plan_id,))
            }
        steps = []
        counts = {"ready": 0, "reconcile": 0, "blocked": 0,
                  "blocked_declined": 0, "completed": 0, "declined": 0}
        config = {step["id"]: step for step in manifest["steps"]}

        def declined_dependencies(step_id):
            """Find stopped prerequisite chains, including transitive declines."""
            affected = []
            for dependency in config[step_id]["depends_on"]:
                if rows[dependency]["state"] == "DECLINED" or declined_dependencies(dependency):
                    affected.append(dependency)
            return affected

        for step in manifest["steps"]:
            step_id, deps = step["id"], step["depends_on"]
            row = rows.get(step_id)
            if row is None:
                raise LandingStateError(f"journal corruption: missing {step_id}")
            state = row["state"]
            pending = [dep for dep in deps if rows[dep]["state"] not in CONFIRMED]
            denied_dependencies = declined_dependencies(step_id) if state == "PLANNED" else []
            if state in CONFIRMED:
                action, group = "COMPLETE", "completed"
            elif state == "DECLINED":
                action, group = "DECLINED_STOP", "declined"
            elif state in UNCERTAIN:
                action, group = "RECONCILE_REMOTE_FIRST", "reconcile"
            elif state == "PLANNED" and denied_dependencies:
                action, group = "STOPPED_BY_DECLINE", "blocked_declined"
            elif state == "PLANNED" and not pending:
                action, group = "READY_TO_ARM", "ready"
            elif state == "PLANNED":
                action, group = "WAIT_DEPENDENCIES", "blocked"
            else:
                raise LandingStateError(f"unknown journal state: {state}")
            counts[group] += 1
            steps.append({
                "step_id": step_id, "state": state, "action": action,
                "depends_on": deps, "pending_dependencies": pending,
                "declined_dependencies": denied_dependencies,
                "repository": step["intent"]["repository"],
                "target": step["intent"]["target"],
                "operation": step["intent"]["operation"],
                "expected_head_sha": step["intent"].get("expected_head_sha"),
            })
        complete = counts["completed"] == len(steps)
        terminal = (counts["completed"] + counts["declined"]
                    + counts["blocked_declined"]) == len(steps)
        return {
            "plan_id": plan_id, "manifest_sha256": meta["manifest_sha256"],
            "complete": complete,
            "terminal": terminal,
            "stopped_by_decline": terminal and not complete,
            "counts": counts, "steps": steps,
            "next_ready": [s["step_id"] for s in steps if s["action"] == "READY_TO_ARM"],
            "reconcile_first": [s["step_id"] for s in steps if s["action"] == "RECONCILE_REMOTE_FIRST"],
        }

    def arm(self, plan_id: str, step_id: str) -> dict:
        """Atomic prerequisite check and reserve before connector invocation.

        Does not cause a GitHub write and does not grant operator consent.
        Existing journal.arm() is also sequence-aware, preventing bypass.
        """
        self.manifest(plan_id)
        return self.journal.arm(plan_id, step_id)

    def reconcile_many(self, plan_id: str, snapshots: dict) -> dict:
        """Apply validated native readbacks, never issue a write or retry."""
        manifest = self.manifest(plan_id)
        if not isinstance(snapshots, dict):
            raise LandingStateError("snapshots must map step IDs to readbacks")
        known = {s["id"] for s in manifest["steps"]}
        if set(snapshots) - known:
            raise LandingStateError("snapshot contains a step not in the sequence")
        # Prevalidate all shapes before making changes.
        if any(not isinstance(snapshot, dict) for snapshot in snapshots.values()):
            raise LandingStateError("each native readback must be a JSON object")
        results = {}
        # All readbacks commit or roll back together. An exception cannot leave
        # a half-reconciled dependency chain after a foreground interruption.
        with self.journal._connect() as db:
            for step in manifest["steps"]:
                step_id = step["id"]
                if step_id in snapshots:
                    result = self.journal._reconcile_in_transaction(
                        db, plan_id, step_id, snapshots[step_id]
                    )
                    results[step_id] = {
                        "state": result["state"], "observation": result["observation"],
                    }
        return {"results": results, "progress": self.status(plan_id)}


    def recover(self, plan_id: str, reader=None) -> dict:
        """Read actual GitHub PR state and resume safe portions of the sequence.

        This is GET-only. Private or inaccessible PRs remain unresolved and do
        not cause any write, retry, fabricated result or terminal failure.
        """
        from .native_readback import GitHubReadback, NativeReadbackUnavailable

        source = reader if reader is not None else GitHubReadback()
        manifest = self.manifest(plan_id)
        current = {row["step_id"]: row for row in self.journal.status(plan_id)["steps"]}
        snapshots, unavailable = {}, {}
        for step in manifest["steps"]:
            step_id = step["id"]
            state = current[step_id]["state"]
            if state in CONFIRMED or state == "DECLINED":
                continue
            try:
                snapshots[step_id] = source.snapshot(step["intent"])
            except (NativeReadbackUnavailable, KeyError, TypeError, ValueError, OSError) as error:
                unavailable[step_id] = str(error)[:240]
        reconciled = self.reconcile_many(plan_id, snapshots)
        return {
            "readbacks_received": list(snapshots),
            "outcomes_confirmed": [
                step_id for step_id, result in reconciled["results"].items()
                if result["observation"] in CONFIRMED
            ],
            "readbacks_unavailable": unavailable,
            "results": reconciled["results"],
            "progress": reconciled["progress"],
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Resume consented GitHub sequences without replaying uncertain writes")
    parser.add_argument("--db", required=True, help="Local durable journal database")
    parser.add_argument("action", choices=("install", "status", "arm", "reconcile", "recover"))
    parser.add_argument("--plan", help="Existing plan ID")
    parser.add_argument("--step", help="Step ID for arm")
    parser.add_argument("--file", help="JSON manifest for install or step->readback map for reconcile")
    options = parser.parse_args()
    engine = LandingSequence(options.db)
    try:
        if options.action == "install":
            if not options.file:
                parser.error("install requires --file")
            result = engine.install(json.loads(Path(options.file).read_text(encoding="utf-8")))
        else:
            if not options.plan:
                parser.error("--plan required")
            if options.action == "status":
                result = engine.status(options.plan)
            elif options.action == "recover":
                result = engine.recover(options.plan)
            elif options.action == "arm":
                if not options.step:
                    parser.error("arm requires --step")
                result = engine.arm(options.plan, options.step)
            else:
                if not options.file:
                    parser.error("reconcile requires --file")
                result = engine.reconcile_many(
                    options.plan, json.loads(Path(options.file).read_text(encoding="utf-8"))
                )
    except (LandingStateError, ValueError, OSError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
