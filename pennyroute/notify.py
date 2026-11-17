"""Route-change notifications via one generic webhook (PENNY_WEBHOOK_URL).

The payload carries the message as both `text` (Slack incoming webhooks,
Telegram sendMessage with ?chat_id=… in the URL) and `content` (Discord),
plus structured fields for custom receivers. Never raises: a failed post is
recorded as a `notify_error` event without the URL, which usually embeds a
secret token.
"""

import os

import httpx

from . import store

TIMEOUT_S = 5.0


def webhook_url() -> str:
    return os.environ.get("PENNY_WEBHOOK_URL", "").strip()


def _route(point: dict) -> str:
    return f"{point.get('model')} @ {point.get('provider')}"


def route_changed(prev: dict, cur: dict) -> None:
    url = webhook_url()
    if not url:
        return
    text = f"JAR route changed: {_route(prev)} -> {_route(cur)}"
    blended = cur.get("blended")
    if isinstance(blended, (int, float)):
        text += f" (${blended:.4f}/M)"
    if cur.get("reason"):
        text += f", {cur['reason']}"
    payload = {"text": text, "content": text, "event": "route_change",
               "from": _route(prev), "to": _route(cur), "blended": blended}
    try:
        resp = httpx.post(url, json=payload, timeout=TIMEOUT_S)
        if resp.status_code >= 400:
            store.log_event("notify_error", {"status": resp.status_code})
    except Exception as e:  # noqa: BLE001 — a dead webhook must not stop the engine
        store.log_event("notify_error", {"error": type(e).__name__})
