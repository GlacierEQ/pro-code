"""Durable, provider-neutral recovery journal for user-consented GitHub landings.

This module NEVER initiates connector writes or grants consent. Call `attempt`
only after the host has actually invoked the consented connector operation.
Its responsibility is replay safety, reconciliation, and truthful readback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager, closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class LandingStateError(RuntimeError):
    """Invalid state transition or mismatch that must not be retried blindly."""


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def validated_intent(intent: dict) -> dict:
    if not isinstance(intent, dict):
        raise LandingStateError("intent must be an object")
    for field in ("operation", "repository", "target"):
        if not isinstance(intent.get(field), str) or not intent[field].strip():
            raise LandingStateError(f"intent.{field} must be a non-empty string")
    extras = set(intent) - {"operation", "repository", "target", "expected", "expected_head_sha"}
    if extras:
        raise LandingStateError(f"unexpected intent fields: {sorted(extras)}; do not store credentials")
    expected = intent.get("expected")
    if not isinstance(expected, dict) or not expected:
        raise LandingStateError("intent.expected must contain explicit readback fields")
    if any(not isinstance(key, str) or not key for key in expected):
        raise LandingStateError("intent.expected field names must be non-empty")
    if intent["operation"] in {"merge_pr", "close_pr"}:
        if not isinstance(intent.get("expected_head_sha"), str) or re.fullmatch(r"[0-9a-f]{40}", intent["expected_head_sha"]) is None:
            raise LandingStateError("PR mutations require a lowercase 40-character hex expected_head_sha")
        if expected.get("head_sha") != intent["expected_head_sha"]:
            raise LandingStateError("expected.head_sha must equal expected_head_sha")
        if intent["operation"] == "merge_pr" and not (expected.get("merged") is True and expected.get("state") == "closed"):
            raise LandingStateError("merge must expect merged=true and state=closed")
        if intent["operation"] == "close_pr" and not (expected.get("merged") is False and expected.get("state") == "closed"):
            raise LandingStateError("close must expect merged=false and state=closed")
    return intent


def matching(expected: Any, observed: Any) -> bool:
    """Partial dict equality; anything absent is unknown, never a match."""
    if isinstance(expected, dict):
        return isinstance(observed, dict) and all(
            key in observed and matching(value, observed[key]) for key, value in expected.items()
        )
    # bool and int must not be interchanged (True == 1 in Python).
    return type(expected) is type(observed) and expected == observed


class LandingJournal:
    def __init__(self, file: str | Path):
        self.path = Path(file).expanduser()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS steps (
                    plan_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    intent_json TEXT NOT NULL,
                    intent_sha256 TEXT NOT NULL,
                    state TEXT NOT NULL,
                    invocation_id TEXT UNIQUE,
                    latest_snapshot_sha256 TEXT,
                    changed_at TEXT NOT NULL,
                    PRIMARY KEY (plan_id, step_id)
                );
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id TEXT NOT NULL,
                    step_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    detail_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
            """)

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA busy_timeout=15000")
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=FULL")
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.execute("COMMIT")
        except sqlite3.OperationalError as error:
            if db.in_transaction:
                db.execute("ROLLBACK")
            if "locked" in str(error).lower() or "busy" in str(error).lower():
                raise LandingStateError("journal busy: inspect native state before any write retry") from error
            raise
        except BaseException:
            if db.in_transaction:
                db.execute("ROLLBACK")
            raise
        finally:
            db.close()

    @contextmanager
    def _read(self):
        """Concurrent readers do not acquire SQLite's write-reservation lock."""
        with closing(sqlite3.connect(self.path, timeout=15)) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA busy_timeout=15000")
            yield db

    @staticmethod
    def _event(db, plan_id, step_id, kind, detail):
        db.execute(
            "INSERT INTO events (plan_id, step_id, event_type, detail_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (plan_id, step_id, kind, canonical(detail), timestamp()),
        )

    @staticmethod
    def _get(db, plan_id, step_id):
        row = db.execute(
            "SELECT * FROM steps WHERE plan_id=? AND step_id=?", (plan_id, step_id)
        ).fetchone()
        if row is None:
            raise LandingStateError(f"unknown planned step: {plan_id}/{step_id}")
        return row

    @staticmethod
    def _ids(plan_id: str, step_id: str) -> None:
        if not all(isinstance(x, str) and x.strip() for x in (plan_id, step_id)):
            raise LandingStateError("plan_id and step_id must be nonempty")

    def plan(self, plan_id: str, step_id: str, intent: dict) -> dict:
        self._ids(plan_id, step_id)
        intent = validated_intent(intent)
        blob = canonical(intent)
        sha = fingerprint(intent)
        with self._connect() as db:
            row = db.execute("SELECT * FROM steps WHERE plan_id=? AND step_id=?", (plan_id, step_id)).fetchone()
            if row:
                if row["intent_sha256"] != sha:
                    raise LandingStateError("existing plan identity is immutable; use a new plan for changes")
                return dict(row)
            db.execute(
                "INSERT INTO steps (plan_id,step_id,intent_json,intent_sha256,state,changed_at) VALUES (?,?,?,?,?,?)",
                (plan_id, step_id, blob, sha, "PLANNED", timestamp()),
            )
            self._event(db, plan_id, step_id, "PLANNED", {"intent_sha256": sha, "operation": intent["operation"]})
            return dict(self._get(db, plan_id, step_id))

    def arm(self, plan_id: str, step_id: str) -> dict:
        """Durably reserve a step BEFORE invoking the host's consented connector.

        A lost foreground session after this call must reconcile remote state,
        not call the write again. ARMED is not evidence of a connector invocation.
        """
        with self._connect() as db:
            row = self._get(db, plan_id, step_id)
            if row["state"] != "PLANNED":
                raise LandingStateError(f"no retry: step is {row['state']}; reconcile with remote first")
            db.execute(
                "UPDATE steps SET state='ARMED',changed_at=? WHERE plan_id=? AND step_id=?",
                (timestamp(), plan_id, step_id),
            )
            self._event(db, plan_id, step_id, "ARMED", {"meaning": "reserved_before_connector_call"})
            return dict(self._get(db, plan_id, step_id))

    def attempt(self, plan_id: str, step_id: str, invocation_id: str) -> dict:
        """Record a connector invocation already initiated in the authorized host."""
        if not isinstance(invocation_id, str) or not invocation_id.strip():
            raise LandingStateError("native connector invocation_id is required")
        with self._connect() as db:
            row = self._get(db, plan_id, step_id)
            if row["state"] != "ARMED":
                raise LandingStateError(f"no retry: step is {row['state']}; must arm first for a new attempt")
            try:
                db.execute(
                    "UPDATE steps SET state='ATTEMPTED',invocation_id=?,changed_at=? WHERE plan_id=? AND step_id=?",
                    (invocation_id, timestamp(), plan_id, step_id),
                )
            except sqlite3.IntegrityError as error:
                raise LandingStateError("native connector invocation ID already belongs to another step") from error
            self._event(db, plan_id, step_id, "ATTEMPTED", {"invocation_id": invocation_id})
            return dict(self._get(db, plan_id, step_id))

    def uncertain(self, plan_id: str, step_id: str, reason: str) -> dict:
        with self._connect() as db:
            row = self._get(db, plan_id, step_id)
            if row["state"] not in {"ARMED", "ATTEMPTED", "UNRESOLVED"}:
                raise LandingStateError(f"cannot mark {row['state']} uncertain")
            db.execute(
                "UPDATE steps SET state='UNRESOLVED',changed_at=? WHERE plan_id=? AND step_id=?",
                (timestamp(), plan_id, step_id),
            )
            self._event(db, plan_id, step_id, "UNRESOLVED", {"reason": str(reason)[:400]})
            return dict(self._get(db, plan_id, step_id))

    def declined(self, plan_id: str, step_id: str, reason: str = "consent declined") -> dict:
        with self._connect() as db:
            row = self._get(db, plan_id, step_id)
            if row["state"] not in {"PLANNED", "ARMED", "ATTEMPTED", "UNRESOLVED"}:
                raise LandingStateError(f"cannot decline {row['state']}")
            db.execute(
                "UPDATE steps SET state='DECLINED',changed_at=? WHERE plan_id=? AND step_id=?",
                (timestamp(), plan_id, step_id),
            )
            self._event(db, plan_id, step_id, "DECLINED", {"reason": str(reason)[:400]})
            return dict(self._get(db, plan_id, step_id))

    def reconcile(self, plan_id: str, step_id: str, snapshot: dict) -> dict:
        """Reconcile an independent native readback; never dispatch/retry a write."""
        with self._connect() as db:
            row = self._get(db, plan_id, step_id)
            if row["state"] == "DECLINED":
                return {**dict(row), "observation": "DECLINED_NOT_RETRIED"}
            intent = json.loads(row["intent_json"])
            if not isinstance(snapshot, dict) or not matching(
                {"repository": intent["repository"], "target": intent["target"]}, snapshot
            ):
                return {**dict(row), "observation": "TARGET_MISMATCH_OR_UNVERIFIED"}
            observed = snapshot.get("observed")
            if not matching(intent["expected"], observed):
                return {**dict(row), "observation": "OUTCOME_NOT_OBSERVED"}
            if row["state"] in {"VERIFIED", "ALREADY_SATISFIED"}:
                return {**dict(row), "observation": row["state"]}
            new_state = "ALREADY_SATISFIED" if row["state"] in {"PLANNED", "ARMED"} else "VERIFIED"
            snapshot_hash = fingerprint({
                "repository": snapshot["repository"], "target": snapshot["target"],
                "observed": {key: observed[key] for key in intent["expected"]},
            })
            db.execute(
                "UPDATE steps SET state=?,latest_snapshot_sha256=?,changed_at=? WHERE plan_id=? AND step_id=?",
                (new_state, snapshot_hash, timestamp(), plan_id, step_id),
            )
            self._event(db, plan_id, step_id, new_state, {"snapshot_sha256": snapshot_hash})
            return {**dict(self._get(db, plan_id, step_id)), "observation": new_state}

    def status(self, plan_id: str | None = None) -> dict:
        with self._read() as db:
            if plan_id is None:
                rows = db.execute("SELECT * FROM steps ORDER BY plan_id,step_id").fetchall()
            else:
                rows = db.execute("SELECT * FROM steps WHERE plan_id=? ORDER BY step_id", (plan_id,)).fetchall()
            return {"steps": [dict(row) for row in rows]}

    def history(self, plan_id: str, step_id: str) -> list[dict]:
        with self._read() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM events WHERE plan_id=? AND step_id=? ORDER BY sequence", (plan_id, step_id)
            )]


def main() -> None:
    p = argparse.ArgumentParser(description="Readback-backed journal only; never invokes GitHub writes")
    p.add_argument("--db", required=True, help="Persistent SQLite journal path")
    p.add_argument("action", choices=("plan", "arm", "attempt", "uncertain", "decline", "reconcile", "status", "history"))
    p.add_argument("--plan", dest="plan_id")
    p.add_argument("--step", dest="step_id")
    p.add_argument("--file", help="Path to intent or native readback JSON")
    p.add_argument("--invocation", help="Native connector invocation identifier")
    p.add_argument("--reason", default="outcome unknown")
    a = p.parse_args()
    journal = LandingJournal(a.db)
    if a.action == "status":
        result = journal.status(a.plan_id)
    else:
        if not a.plan_id or not a.step_id:
            p.error("--plan and --step are required for this action")
        if a.action in {"plan", "reconcile"}:
            if not a.file:
                p.error("--file JSON path required")
            data = json.loads(Path(a.file).read_text(encoding="utf-8"))
            result = journal.plan(a.plan_id, a.step_id, data) if a.action == "plan" else journal.reconcile(a.plan_id, a.step_id, data)
        elif a.action == "arm":
            result = journal.arm(a.plan_id, a.step_id)
        elif a.action == "attempt":
            result = journal.attempt(a.plan_id, a.step_id, a.invocation)
        elif a.action == "uncertain":
            result = journal.uncertain(a.plan_id, a.step_id, a.reason)
        elif a.action == "decline":
            result = journal.declined(a.plan_id, a.step_id, a.reason)
        else:
            result = journal.history(a.plan_id, a.step_id)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
