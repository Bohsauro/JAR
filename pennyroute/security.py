"""PennyRoute — access control for hosted use.

- /api/* (management) needs PENNY_ADMIN_TOKEN. With no token configured it is
  reachable only from loopback, so a fresh install is never open to the LAN/WAN.
- /v1/* is guarded by API keys (keys.py) and a per-IP rate limit.

shortcut: counters live in process memory (single uvicorn worker), reset on
restart; move to Redis if the service ever runs with several workers.
"""

import hmac
import os
import threading
import time

from fastapi import Request

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}
ADMIN_FAIL_LIMIT = 10  # wrong-token attempts per minute per IP

_hits: dict = {}
_hits_lock = threading.Lock()


def admin_token() -> str:
    return os.environ.get("PENNY_ADMIN_TOKEN", "").strip()


def v1_rate_limit() -> int:
    try:
        return int(os.environ.get("PENNY_RATE_LIMIT", "120"))  # req/min/IP, 0 = off
    except ValueError:
        return 120


def rate_limited(key, limit: int, window: float = 60.0) -> bool:
    """Count one hit for `key`; True when it exceeds `limit` in `window` s."""
    now = time.monotonic()
    with _hits_lock:
        if len(_hits) > 10000:  # bound memory under address churn
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
                del _hits[k]
        recent = [t for t in _hits.get(key, []) if now - t < window]
        recent.append(now)
        _hits[key] = recent
    return len(recent) > limit


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def check_admin(request: Request):
    """None if allowed, else (status, detail)."""
    ip = client_ip(request)
    token = admin_token()
    if not token:
        # a proxy on the same host shows up as loopback: X-Forwarded-For gives it away
        if ip in _LOOPBACK and "x-forwarded-for" not in request.headers:
            return None
        return 403, "management API is local-only: set PENNY_ADMIN_TOKEN to enable remote access"
    auth = request.headers.get("authorization", "")
    given = request.headers.get("x-admin-token") or (
        auth[7:] if auth.lower().startswith("bearer ") else "")
    if given and hmac.compare_digest(given.strip(), token):
        return None
    if rate_limited(("admin-fail", ip), ADMIN_FAIL_LIMIT):
        return 429, "too many failed attempts"
    return 401, "admin token required"
