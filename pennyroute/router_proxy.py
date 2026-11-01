"""PennyRoute — OpenAI-compatible reverse proxy with chain-based failover.

Resolves the primary fallback chain (or an explicit one) into an ordered list
of candidate (model, provider) pairs, then forwards /v1/chat/completions to
OpenRouter. If a candidate errors, the next one is tried; the client never
sees the switch.

Request model field routing rules:
  - "penny" or "penny:<chain>"  -> resolve that chain (default: primary)
  - any other value              -> treated as a model id; provider = auto
"""

import json
import re
import time

import httpx
from fastapi import HTTPException, Request

from . import orclient, providers, ranking
from . import store


def _prov_ok(name: str) -> bool:
    """Shared availability gate (spec 1.4): same as ranking.resolve_chain."""
    return bool(providers.is_available(name).get("available"))


def build_candidates(chain: dict, settings: dict) -> list[dict]:
    """Ordered candidate list for a chain: [(model, provider), ...].

    Within a chain step, all eligible (healthy + available) endpoints of the
    target model are added (cheapest first) so a provider error or exhaustion
    tries the next provider of the SAME model before falling through to the
    next chain step. `model` entries with `providers` add one candidate per
    provider in order (first available+healthy wins at forward time).
    """
    mix = settings["mix"]
    gates = {"min_tps": settings["min_tps"], "min_uptime": settings["min_uptime"]}
    ranked = ranking.rank_models(store.load_models(), mix, gates)
    out: list[dict] = []
    seen: set = set()

    def add(slug: str, provider: str | None):
        key = (slug, provider)
        if key not in seen:
            seen.add(key)
            out.append({"model": slug, "provider": provider})

    for entry in chain.get("entries") or []:
        if entry.get("type") == "cheapest":
            flt = entry.get("filter") or ""
            restrict = entry.get("providers")
            pool = [m for m in ranked if (not flt or flt in m["slug"])]
            for m in pool:
                b = m.get("best")
                if not b or not b.get("healthy"):
                    continue
                if not _prov_ok(b["provider"]):
                    continue
                if restrict and b["provider"] not in restrict:
                    continue
                add(m["slug"], b["provider"])
        else:
            slug = entry.get("model")
            if not slug:
                continue
            eps = [e for e in ranking.rank_endpoints(slug, mix, gates)
                   if not (isinstance(e, dict) and "error" in e)]
            provs = entry.get("providers")
            if provs:
                # ordered preference: one candidate per available+healthy provider
                for pname in provs:
                    if _prov_ok(pname) and any(
                            e["provider"] == pname and e["healthy"] for e in eps):
                        add(slug, pname)
            else:
                # auto: all healthy, available endpoints
                for e in eps:
                    if e["healthy"] and _prov_ok(e["provider"]):
                        add(slug, e["provider"])
    return out


async def proxy_chat(request: Request, body: dict):
    """Forward a chat completion through the chain. Returns httpx.Response."""
    settings = store.load_settings()
    mix = settings["mix"]
    gates = {"min_tps": settings["min_tps"], "min_uptime": settings["min_uptime"]}

    requested = (body.get("model") or "").strip()
    if requested.startswith("penny:"):
        chain_name = requested[6:] or None
    elif requested == "penny":
        chain_name = None
    elif requested and requested in [c["name"] for c in store.load_chains()]:
        chain_name = requested
    else:
        # fixed model passthrough: route it through cheapest-healthy providers
        chain = {"name": "_passthrough", "entries": [{"type": "model",
                 "model": requested or (store.load_chains()[0]["name"]
                                        if store.load_chains() else "")}]}
        candidates = build_candidates(chain, settings) if requested else []
        if not candidates:
            # unknown model: let the primary chain decide
            chains = store.load_chains()
            primary = next((c for c in chains if c.get("primary")), None)
            candidates = build_candidates(primary, settings) if primary else []
        return await _forward(request, body, candidates)

    chains = store.load_chains()
    if chain_name:
        chain = next((c for c in chains if c["name"] == chain_name), None)
    else:
        chain = next((c for c in chains if c.get("primary")), None)
    if not chain:
        raise HTTPException(404, f"chain not found: {chain_name or 'primary'}")

    candidates = build_candidates(chain, settings)
    if not candidates:
        raise HTTPException(502, "no healthy candidate in chain")
    return await _forward(request, body, candidates)


async def _forward(request: Request, body: dict, candidates: list[dict]):
    """Try candidates in order. Streams through on success."""
    last_error = None
    stream = bool(body.get("stream"))

    for cand in candidates:
        pname = cand.get("provider")
        # race guard (spec 1.5): providers may have just exhausted
        if pname:
            av = providers.is_available(pname)
            if not av["available"]:
                store.log_event("proxy_skip", {
                    "model": cand["model"], "provider": pname,
                    "reasons": av["reasons"]})
                last_error = (f"provider unavailable: {pname} "
                              f"({', '.join(av['reasons'])})")
                continue
        payload = dict(body)
        payload["model"] = cand["model"]
        if pname:
            payload["provider"] = {"order": [pname],
                                   "allow_fallbacks": False}
        headers = {
            "Authorization": f"Bearer {orclient.get_key()}",
            "Content-Type": "application/json",
        }
        try:
            if stream:
                client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=600.0))
                req = client.build_request(
                    "POST", "https://openrouter.ai/api/v1/chat/completions",
                    content=json.dumps(payload).encode(), headers=headers)
                raw = await client.send(req, stream=True)
                if raw.status_code >= 400:
                    await raw.aclose()
                    await client.aclose()
                    last_error = f"{raw.status_code} @ {cand['model']}/{pname}"
                    continue
                return StreamingResp(
                    _wrap_stream(raw, cand["model"], pname), client,
                    status_code=raw.status_code, headers=dict(raw.headers),
                    media_type=raw.headers.get("content-type"))
            else:
                async with httpx.AsyncClient(
                        timeout=httpx.Timeout(10.0, read=600.0)) as client:
                    raw = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        content=json.dumps(payload).encode(), headers=headers)
                if raw.status_code >= 400:
                    last_error = f"{raw.status_code} @ {cand['model']}/{pname}"
                    continue
                data = raw.json()
                data.setdefault("pennyroute", {
                    "served_by": f"{cand['model']} @ {pname}",
                    "chain_tried": len(candidates)})
                # record usage + remaining headroom for this provider
                if pname:
                    providers.record_usage(pname, cand["model"], data.get("usage"))
                    data["pennyroute"]["provider_usage"] = _provider_usage_summary(pname)
                return data
        except Exception as e:  # noqa: BLE001
            last_error = f"{type(e).__name__}: {e} @ {cand['model']}/{pname}"
            continue

    store.log_event("proxy_error", {"error": last_error})
    raise HTTPException(502, f"all chain candidates failed; last: {last_error}")


_TAIL_BYTES = 65536


def _usage_from_tail(tail: str):
    """Best-effort extraction of the last OpenAI usage object (may contain
    nested objects, e.g. prompt_tokens_details — use brace balancing)."""
    idx = tail.rfind('"usage"')
    if idx < 0:
        return None
    start = tail.find("{", idx)
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(tail)):
        c = tail[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    u = json.loads(tail[start:i + 1])
                except (ValueError, json.JSONDecodeError):
                    return None
                return u if isinstance(u, dict) else None
    return None


def _provider_usage_summary(name: str) -> dict:
    """Small per-limit summary (pct + remaining) for pennyroute.provider_usage."""
    st = providers.limits_status(name)
    out = {}
    for t in ("requests", "tokens", "spend"):
        v = st.get(t)
        if isinstance(v, dict):
            out[t] = {"per": v.get("per"), "pct": v.get("pct"),
                      "remaining": v.get("remaining")}
    return out


async def _wrap_stream(raw, model: str, provider: str):
    """Buffer a 64 KB rolling tail; record usage at end. No injection (keeps stream byte-pure)."""
    tail = ""
    try:
        async for chunk in raw.aiter_bytes():
            text = chunk.decode("utf-8", errors="ignore")
            tail = (tail + text)[-_TAIL_BYTES:]
            yield text.encode("utf-8")
    finally:
        try:
            providers.record_usage(provider, model, _usage_from_tail(tail))
        except Exception:  # noqa: BLE001 — usage is best effort
            pass


from fastapi.responses import StreamingResponse  # noqa: E402


class StreamingResp(StreamingResponse):
    """StreamingResponse that owns the httpx client and closes it after."""

    def __init__(self, aiter, client: httpx.AsyncClient, status_code=200,
                 headers=None, media_type=None):
        self._client = client
        super().__init__(aiter, status_code=status_code, headers=headers,
                         media_type=media_type)

    async def stream_response(self, send):
        try:
            await super().stream_response(send)
        finally:
            await self._client.aclose()
