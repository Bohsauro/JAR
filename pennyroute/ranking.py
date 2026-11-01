"""PennyRoute — cost ranking + fallback-chain resolution.

The cost metric is the *blended* price per 1M total tokens under the user's
real token mix (default measured: 14% input / 85% cache-read / 1% output):

    blended = in_f * input + cache_f * cache_read + out_f * output

Health gate: an endpoint is "healthy" only if throughput p50 >= min_tps and
uptime >= min_uptime. Chains walk entries in order and resolve to the first
healthy one; `cheapest` entries pick the cheapest healthy endpoint across the
whole watchlist.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed

from . import orclient
from . import providers
from . import store


def _mix_tuple(mix: dict):
    return (float(mix.get("in", 0.14)),
            float(mix.get("cache", 0.85)),
            float(mix.get("out", 0.01)))


def rank_endpoints(slug: str, mix: dict, gates: dict, force: bool = False) -> list:
    """Endpoints for one model, ranked by blended cost (healthy first)."""
    raw = orclient.fetch_endpoints_raw(slug, force)
    if isinstance(raw, dict) and "error" in raw:
        return [{"error": raw["error"]}]
    in_f, cache_f, out_f = _mix_tuple(mix)
    min_tps = float(gates.get("min_tps", 45))
    min_up = float(gates.get("min_uptime", 99.0))

    rows = []
    for ep in raw:
        out = ep["out"] if ep["out"] is not None else ep["in"]
        blended = in_f * ep["in"] + cache_f * ep["cache"] + out_f * out
        healthy = (ep["tps"] is not None and ep["tps"] >= min_tps
                   and ep["uptime"] is not None and ep["uptime"] >= min_up)
        rows.append({**ep, "out": out, "blended": blended, "healthy": healthy})

    rows.sort(key=lambda r: (not r["healthy"], r["blended"], -(r["tps"] or 0)))
    return rows


def _best_endpoint(slug: str, mix: dict, gates: dict, force: bool = False):
    rows = rank_endpoints(slug, mix, gates, force)
    if rows and "error" in rows[0]:
        return {"slug": slug, "error": rows[0]["error"]}
    healthy = [r for r in rows if r["healthy"]]
    pool = healthy or rows
    best = pool[0] if pool else None
    return {
        "slug": slug,
        "best": best,
        "provider_count": len(rows),
        "healthy_count": len(healthy),
    }


def rank_models(models: list, mix: dict, gates: dict, force: bool = False) -> list:
    """Rank the watchlist by blended cost of each model's best endpoint."""
    out = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(_best_endpoint, m["slug"], mix, gates, force): m
                for m in models}
        for f in as_completed(futs):
            try:
                res = f.result()
            except Exception as e:  # noqa: BLE001
                res = {"slug": futs[f]["slug"], "error": str(e)}
            res["note"] = futs[f].get("note", "")
            out.append(res)

    def key(x):
        b = x.get("best")
        return (1, 1e12) if not b else (0 if b["healthy"] else 2, b["blended"])

    out.sort(key=key)
    return out


def _default_provider_ok(name: str):
    """Shared availability check (spec 1.4): same function for engine + proxy."""
    return bool(providers.is_available(name).get("available"))


def resolve_chain(chain: dict, ranked: list, mix: dict, gates: dict,
                  provider_ok=None) -> dict | None:
    """Walk a fallback chain; return the first healthy entry resolved.

    Returns {'index', 'type', 'model', 'provider', 'blended', 'reason'} or None
    if nothing healthy was found.

    `provider_ok(name)` filters providers by availability; defaults to the
    shared `providers.is_available` so the engine never resolves to an
    exhausted/blocked provider.
    """
    if provider_ok is None:
        provider_ok = _default_provider_ok

    def _ep_ok(ep):
        return bool(ep and ep.get("healthy")) and bool(provider_ok(ep.get("provider")))

    for i, entry in enumerate(chain.get("entries") or []):
        if entry.get("type") == "cheapest":
            flt = entry.get("filter") or ""
            restrict = entry.get("providers")
            pool = [m for m in ranked if (not flt or flt in m["slug"])]
            for m in pool:
                b = m.get("best")
                if not b:
                    continue
                if restrict and b.get("provider") not in restrict:
                    continue
                if _ep_ok(b):
                    return {"index": i, "type": "cheapest",
                            "model": m["slug"], "provider": b["provider"],
                            "blended": b["blended"],
                            "reason": f"cheapest healthy{' (' + flt + ')' if flt else ''} in watchlist"}
            continue

        slug = entry.get("model")
        if not slug:
            continue
        provs = entry.get("providers")
        if provs:
            # ordered hard preference: first available+healthy provider wins
            rows = rank_endpoints(slug, mix, gates)
            rows = [r for r in rows if not (isinstance(r, dict) and "error" in r)]
            for n, pname in enumerate(provs, start=1):
                match = next((r for r in rows
                              if r.get("provider") == pname and _ep_ok(r)), None)
                if match:
                    return {"index": i, "type": "model", "model": slug,
                            "provider": pname, "blended": match["blended"],
                            "reason": f"provider #{n} in step order"}
            continue  # none available -> whole step skipped, chain continues

        # auto: cheapest healthy endpoint across all providers (unchanged)
        best = _best_endpoint(slug, mix, gates)
        b = best.get("best")
        if _ep_ok(b):
            return {"index": i, "type": "model", "model": slug,
                    "provider": b["provider"], "blended": b["blended"],
                    "reason": f"cheapest healthy endpoint for {slug}"}
    return None
