"""GitHub-native, GET-only PR readback for interrupted connector landings.

This adapter cannot create, close, merge, authorize or retry a pull request.
It independently checks PR identity, exact head, and merge ancestry before
returning a snapshot usable by LandingJournal.reconcile.
"""
from __future__ import annotations

import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from .landing_journal import LandingStateError

REPOSITORY = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
PR_TARGET = re.compile(r"^pull/([1-9][0-9]*)$")
SHA = re.compile(r"^[0-9a-f]{40}$")


class NativeReadbackUnavailable(LandingStateError):
    """Provider status is unavailable or contradictory, so outcome remains unknown."""


class GitHubReadback:
    def __init__(self, get_json=None, timeout=12):
        self.timeout = timeout
        self.get_json = get_json or self._get_public_json

    def _get_public_json(self, api_path):
        """Public GitHub REST GET only. No alternate token or write lane."""
        request = Request(
            "https://api.github.com" + api_path,
            method="GET",
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "GlacierEQ-consented-landing-readback",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            raise NativeReadbackUnavailable("GitHub readback unavailable: " + type(exc).__name__) from exc

    def snapshot(self, intent):
        operation = intent.get("operation")
        if operation not in {"merge_pr", "close_pr"}:
            raise NativeReadbackUnavailable("native readback currently supports merge_pr and close_pr")
        repository = intent.get("repository")
        target = intent.get("target")
        if not isinstance(repository, str) or not REPOSITORY.fullmatch(repository):
            raise NativeReadbackUnavailable("repository must be exactly owner/repo")
        match = PR_TARGET.fullmatch(target) if isinstance(target, str) else None
        if not match:
            raise NativeReadbackUnavailable("target must be exactly pull/<positive integer>")
        expected_head = intent.get("expected_head_sha")
        if not isinstance(expected_head, str) or not SHA.fullmatch(expected_head):
            raise NativeReadbackUnavailable("missing valid expected PR head SHA")
        prefix = "/repos/" + repository
        pr_path = prefix + "/pulls/" + match.group(1)
        try:
            pr = self.get_json(pr_path)
            if not isinstance(pr, dict):
                raise NativeReadbackUnavailable("PR readback is not an object")
            head = pr["head"]["sha"]
            base = pr["base"]["repo"]["full_name"]
            branch = pr["base"]["ref"]
            state = pr["state"]
            merged_at = pr.get("merged_at")
            merge_sha = pr.get("merge_commit_sha")
            if base != repository or branch != "main":
                raise NativeReadbackUnavailable("PR targets a different repository or branch")
            if head != expected_head:
                raise NativeReadbackUnavailable("PR head changed; do not infer prior approval covers a new SHA")
            merged = state == "closed" and bool(merged_at)
            if operation == "merge_pr":
                if not merged or not isinstance(merge_sha, str) or not SHA.fullmatch(merge_sha):
                    raise NativeReadbackUnavailable("exact requested merge not proven")
                relation = self.get_json(prefix + "/compare/" + merge_sha + "...main")
                if not isinstance(relation, dict) or relation.get("status") not in {"ahead", "identical"}:
                    raise NativeReadbackUnavailable("merge commit not proven ancestral to main")
            else:
                if state != "closed" or merged_at is not None:
                    raise NativeReadbackUnavailable("unmerged PR closure not proven")
                if pr.get("merged") is True:
                    raise NativeReadbackUnavailable("GitHub reports merged PR, cannot count as closure")
            return {
                "repository": repository,
                "target": target,
                "observed": {
                    "head_sha": head,
                    "state": state,
                    "merged": merged,
                    "merge_commit_sha": merge_sha,
                },
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise NativeReadbackUnavailable("incomplete or invalid native GitHub readback") from exc
