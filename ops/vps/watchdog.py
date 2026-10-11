#!/usr/bin/env python3
"""Independent, lightweight scheduler recovery. Does not scrape or write the database."""
import datetime
import json
import os
import pathlib
import urllib.error
import urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "SushantKadam73/fixed-return-tracker")
TOKEN = os.environ.get("GITHUB_DISPATCH_TOKEN")
STATE = pathlib.Path(os.environ.get("WATCHDOG_STATE", "/tmp/fixed-return-tracker-watchdog.json"))
if not TOKEN:
    raise SystemExit("Set a repository-scoped GITHUB_DISPATCH_TOKEN with Actions read/write.")

def api(endpoint, payload=None):
    request = urllib.request.Request(
        "https://api.github.com/repos/" + REPO + endpoint,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"},
        method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read()
        return json.loads(body) if body else {}

now = datetime.datetime.now(datetime.timezone.utc)
runs = api("/actions/workflows/collect.yml/runs?branch=main&per_page=30").get("workflow_runs", [])
if any(run["status"] in ("queued", "in_progress", "waiting", "requested", "pending") for run in runs):
    print("Collector already queued or running; no duplicate dispatch.")
    raise SystemExit(0)
# A workflow may be partial because one bank is blocked, while still having saved useful data.
# Scheduling health is distinct from the per-source validation health on /status.
last = max((datetime.datetime.fromisoformat(run["created_at"].replace("Z", "+00:00")) for run in runs), default=None)
if last and now - last < datetime.timedelta(hours=26):
    print("Collector schedule is recent; source failures remain visible on the website.")
    raise SystemExit(0)
previous = json.loads(STATE.read_text()) if STATE.exists() else {}
if now.timestamp() - previous.get("lastDispatch", 0) < 6 * 3600:
    print("Recovery dispatch cooling down.")
    raise SystemExit(0)
api("/actions/workflows/collect.yml/dispatches", {"ref": "main", "inputs": {"scope": "all"}})
STATE.parent.mkdir(parents=True, exist_ok=True)
STATE.write_text(json.dumps({"lastDispatch": now.timestamp()}))
print("Daily collector recovery dispatched.")
