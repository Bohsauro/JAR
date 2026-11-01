"""PennyRoute — FastAPI app.

Run:  uvicorn pennyroute.app:app --host 0.0.0.0 --port 8490
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from . import engine
from . import keys
from . import orclient
from . import providers
from . import ranking
from . import router_proxy
from . import store

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="PennyRoute", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    engine.start()


def _require_key(request: Request):
    raw = request.headers.get("x-api-key") or request.headers.get("authorization")
    if not keys.verify_key(raw):
        raise HTTPException(401, "invalid or missing API key")


# ------------------------------------------------------------- /v1 (router) --

@app.post("/v1/chat/completions")
async def v1_chat(request: Request):
    _require_key(request)
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "JSON body required")
    return await router_proxy.proxy_chat(request, body)


@app.get("/v1/models")
def v1_models(request: Request):
    _require_key(request)
    # what the primary chain would serve right now
    settings = store.load_settings()
    ranked = ranking.rank_models(store.load_models(), settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]})
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    res = ranking.resolve_chain(primary, ranked, settings["mix"],
                                {"min_tps": settings["min_tps"],
                                 "min_uptime": settings["min_uptime"]}) if primary else None
    served = res["model"] if res else None
    # chains first: every fallback chain is selectable as a "model"
    data = [
        {"id": "penny", "object": "model",
         "owned_by": "pennyroute-chain-primary",
         "created": 0}
    ]
    for c in chains:
        if not c.get("primary"):
            data.append({"id": f"penny:{c['name']}", "object": "model",
                         "owned_by": "pennyroute-chain", "created": 0})
    data += [{"id": m["slug"], "object": "model",
              "owned_by": "pennyroute"} for m in store.load_models()]
    if served:
        data.insert(0, {"id": served, "object": "model", "owned_by": "pennyroute-primary"})
    return {"object": "list", "data": data}


# ---------------------------------------------------------------- state ----

@app.get("/api/state")
def api_state():
    settings = store.load_settings()
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    return {
        "active": engine.current_active(),
        "primary_chain": primary["name"] if primary else None,
        "settings": settings,
        "model_count": len(store.load_models()),
        "providers": providers.overview(),
    }


# ------------------------------------------------------------- providers ---

class ProviderIn(BaseModel):
    note: str | None = None
    blocked: bool | None = None
    limits: dict | None = None


@app.get("/api/providers")
def api_providers():
    """Registry + usage + status per provider. Unavailable/blocked first."""
    reg = providers.load_registry()
    usage = providers.load_usage()
    out = []
    for name, entry in reg.items():
        entry = entry if isinstance(entry, dict) else {}
        st = providers.limits_status(name)
        out.append({
            "name": name,
            "note": entry.get("note") or "",
            "blocked": bool(entry.get("blocked")),
            "limits": entry.get("limits") or {},
            "usage": usage.get(name) or {},
            "status": st,
        })

    def sort_key(p):
        day = (p["usage"] or {}).get("day") or {}
        base = 0 if not providers.is_available(p["name"])["available"] else 1
        return (base, -(day.get("requests") or 0))

    out.sort(key=sort_key)
    return {"providers": out}


@app.put("/api/providers/{name}")
def api_put_provider(name: str, p: ProviderIn):
    patch = {}
    if p.note is not None:
        patch["note"] = p.note
    if p.blocked is not None:
        patch["blocked"] = p.blocked
    if p.limits is not None:
        patch["limits"] = p.limits
    merged = providers.set_provider(name, patch)
    return {"ok": True, "provider": merged}


@app.delete("/api/providers/{name}")
def api_del_provider(name: str):
    if not providers.remove_provider(name):
        raise HTTPException(404, "provider not found")
    return {"ok": True}


@app.post("/api/providers/{name}/reset")
def api_reset_provider(name: str):
    if name not in providers.load_registry():
        raise HTTPException(404, "provider not found")
    providers.reset_usage(name)
    return {"ok": True}


# --------------------------------------------------------------- ranking ---

@app.get("/api/rank")
def api_rank(force: bool = False):
    settings = store.load_settings()
    ranked = ranking.rank_models(store.load_models(), settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]},
                                 force=force)
    return {"models": ranked, "mix": settings["mix"]}


@app.get("/api/endpoints/{slug:path}")
def api_endpoints(slug: str, force: bool = False):
    settings = store.load_settings()
    rows = ranking.rank_endpoints(slug, settings["mix"],
                                  {"min_tps": settings["min_tps"],
                                   "min_uptime": settings["min_uptime"]},
                                  force=force)
    if isinstance(rows, list):
        for r in rows:
            if isinstance(r, dict) and "error" not in r:
                r["available"] = providers.is_available(r["provider"])["available"]
    return {"slug": slug, "mix": settings["mix"], "endpoints": rows}


_FAMILY_FACET_TOP = 30
_CATALOG_LIMIT_MAX = 200
_CATALOG_LIMIT_DEFAULT = 50


@app.get("/api/catalog")
def api_catalog(q: str = "", tier: str = "", family: str = "", tag: str = "",
                sort: str = "", limit: int = _CATALOG_LIMIT_DEFAULT,
                offset: int = 0):
    """Full catalog with health-free filters + facets (spec 1.3)."""
    cat = orclient.fetch_catalog()
    if isinstance(cat, dict):
        return cat
    q = (q or "").strip().lower()
    wl = {m["slug"] for m in store.load_models()}

    def match(e):
        if q and q not in e["id"].lower() and q not in (e["name"] or "").lower():
            return False
        if tier and e["tier"] != tier:
            return False
        if family and e["family"] != family:
            return False
        if tag and tag not in e["tags"]:
            return False
        return True

    filtered = [e for e in cat if match(e)]

    if sort == "price_asc":
        filtered.sort(key=lambda e: (e["in_$M"] is None, e["in_$M"] or 0.0))
    elif sort == "price_desc":
        filtered.sort(key=lambda e: (e["in_$M"] is None, -(e["in_$M"] or 0.0)))
    elif sort == "name":
        filtered.sort(key=lambda e: (e["name"] or e["id"] or "").lower())
    elif sort == "ctx_desc":
        filtered.sort(key=lambda e: (e["ctx"] is None, -(e["ctx"] or 0)))

    # facets over the FULL catalog (not the filtered page)
    tiers = {}
    tags = {}
    fam = {}
    for e in cat:
        tiers[e["tier"]] = tiers.get(e["tier"], 0) + 1
        fam[e["family"]] = fam.get(e["family"], 0) + 1
        for t in e["tags"] or []:
            tags[t] = tags.get(t, 0) + 1
    fam_rank = sorted(fam.items(), key=lambda kv: (-kv[1], kv[0]))
    families = {n: c for n, c in fam_rank[:_FAMILY_FACET_TOP]}
    other = sum(c for _, c in fam_rank[_FAMILY_FACET_TOP:])
    if other:
        families["other"] = other

    limit = max(1, min(limit or _CATALOG_LIMIT_DEFAULT, _CATALOG_LIMIT_MAX))
    offset = max(0, offset or 0)
    results = [dict(e, wl=e["id"] in wl) for e in filtered[offset:offset + limit]]
    return {"total": len(filtered), "results": results,
            "facets": {"tiers": tiers, "families": families, "tags": tags}}


# ---------------------------------------------------------------- models ---

class ModelIn(BaseModel):
    slug: str
    note: str = ""


class ModelsBulkIn(BaseModel):
    slugs: list[str] = []


@app.get("/api/models")
def api_models():
    return {"models": store.load_models()}


@app.get("/api/presets")
def api_presets():
    return {"presets": store.list_presets()}


@app.post("/api/presets/{name}")
def api_apply_preset(name: str):
    """Replace the watchlist with a preset. Returns the new watchlist."""
    models = store.preset_models(name)
    if models is None:
        raise HTTPException(404, "preset not found")
    store.save_models(models)
    store.log_event("preset", {"preset": name, "count": len(models)})
    return {"ok": True, "preset": name, "models": store.load_models()}


@app.post("/api/models")
def api_add_model(m: ModelIn):
    slug = m.slug.strip()
    if not slug:
        raise HTTPException(400, "empty slug")
    if not store.add_model(slug, m.note):
        raise HTTPException(409, "already in watchlist")
    return {"ok": True}


@app.post("/api/models/bulk")
def api_models_bulk(b: ModelsBulkIn):
    """Add many watchlist entries; dedup + skip existing (never errors)."""
    added = skipped = 0
    for slug in b.slugs or []:
        slug = (slug or "").strip()
        if not slug:
            skipped += 1
            continue
        if store.add_model(slug, ""):
            added += 1
        else:
            skipped += 1
    store.log_event("bulk_add", {"added": added, "skipped": skipped})
    return {"ok": True, "added": added, "skipped": skipped}


@app.delete("/api/models/{slug:path}")
def api_del_model(slug: str):
    if not store.remove_model(slug):
        raise HTTPException(404, "not in watchlist")
    return {"ok": True}


# ---------------------------------------------------------------- chains ---

class ChainIn(BaseModel):
    name: str
    auto_apply: bool = True
    note: str = ""
    entries: list[dict] = []


@app.get("/api/chains")
def api_chains():
    return {"chains": store.load_chains()}


def _validate_chain(chain: dict):
    for e in chain.get("entries") or []:
        if e.get("type") == "model" and not e.get("model"):
            raise HTTPException(400, "model entry without slug")
        if e.get("type") not in ("model", "cheapest"):
            raise HTTPException(400, "unknown entry type")
        if "note" in e and e["note"] is not None and not isinstance(e["note"], str):
            raise HTTPException(400, "entry note must be a string")
        if "providers" in e and e["providers"] is not None:
            if not isinstance(e["providers"], list) or not all(
                    isinstance(x, str) and x for x in e["providers"]):
                raise HTTPException(400, "entry providers must be a list of non-empty strings")


@app.post("/api/chains")
def api_add_chain(c: ChainIn):
    chains = store.load_chains()
    if any(x["name"] == c.name for x in chains):
        raise HTTPException(409, "chain name exists")
    chain = {"name": c.name, "primary": False, "auto_apply": c.auto_apply,
             "note": c.note, "entries": c.entries}
    _validate_chain(chain)
    chains.append(chain)
    store.save_chains(chains)
    return {"ok": True}


@app.put("/api/chains/{name}")
def api_update_chain(name: str, c: ChainIn):
    chains = store.load_chains()
    for i, x in enumerate(chains):
        if x["name"] == name:
            chain = {"name": name, "primary": x.get("primary", False),
                     "auto_apply": c.auto_apply, "note": c.note,
                     "entries": c.entries}
            _validate_chain(chain)
            chains[i] = chain
            store.save_chains(chains)
            return {"ok": True}
    raise HTTPException(404, "chain not found")


@app.post("/api/chains/{name}/primary")
def api_set_primary(name: str):
    chains = store.load_chains()
    if not any(x["name"] == name for x in chains):
        raise HTTPException(404, "chain not found")
    for x in chains:
        x["primary"] = (x["name"] == name)
    store.save_chains(chains)
    store.log_event("primary", {"chain": name})
    return {"ok": True}


@app.delete("/api/chains/{name}")
def api_del_chain(name: str):
    chains = store.load_chains()
    primary = next((x for x in chains if x["name"] == name), None)
    if primary and primary.get("primary") and len(chains) > 1:
        raise HTTPException(400, "set another chain primary first")
    store.save_chains([x for x in chains if x["name"] != name])
    return {"ok": True}


# --------------------------------------------------------------- apply ----

class ApplyIn(BaseModel):
    model: str
    provider: str


@app.post("/api/apply")
def api_apply(a: ApplyIn):
    settings = store.load_settings()
    res = engine.apply_choice(a.model, a.provider,
                              restart=settings.get("gateway_restart", True))
    return {"ok": True, **res}


@app.post("/api/evaluate")
def api_evaluate():
    return engine.evaluate_primary()


# ------------------------------------------------------------- settings ---

class SettingsIn(BaseModel):
    mix: dict | None = None
    min_tps: float | None = None
    min_uptime: float | None = None
    interval_min: int | None = None
    gateway_restart: bool | None = None


@app.get("/api/settings")
def api_settings():
    return store.load_settings()


@app.put("/api/settings")
def api_set_settings(s: SettingsIn):
    cur = store.load_settings()
    if s.mix:
        cur["mix"] = s.mix
    for k in ("min_tps", "min_uptime", "interval_min", "gateway_restart"):
        if getattr(s, k) is not None:
            cur[k] = getattr(s, k)
    store.save_settings(cur)
    return {"ok": True, "settings": cur}


# --------------------------------------------------------------- events ---

@app.get("/api/events")
def api_events(limit: int = 60):
    return {"events": store.load_events(limit)}


# ----------------------------------------------------------------- keys ---

class KeyIn(BaseModel):
    name: str = "default"


@app.get("/api/keys")
def api_keys():
    return {"keys": keys.list_keys()}


@app.post("/api/keys")
def api_create_key(k: KeyIn):
    res = keys.create_key(k.name)
    if not res:
        raise HTTPException(500, "could not create key")
    return res


@app.delete("/api/keys/{key_id}")
def api_revoke_key(key_id: str):
    if not keys.revoke_key(key_id):
        raise HTTPException(404, "key not found")
    return {"ok": True}


@app.get("/api/resolve")
def api_resolve():
    """What the primary chain would serve right now (for the API page)."""
    settings = store.load_settings()
    ranked = ranking.rank_models(store.load_models(), settings["mix"],
                                 {"min_tps": settings["min_tps"],
                                  "min_uptime": settings["min_uptime"]})
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    res = ranking.resolve_chain(primary, ranked, settings["mix"],
                                {"min_tps": settings["min_tps"],
                                 "min_uptime": settings["min_uptime"]}) if primary else None
    return {"resolution": res, "key_count": len(keys.list_keys())}


@app.get("/api/pipeline")
def api_pipeline():
    """Fallback pipeline: ordered candidates with live indicators."""
    settings = store.load_settings()
    chains = store.load_chains()
    primary = next((c for c in chains if c.get("primary")), None)
    if not primary:
        return {"candidates": [], "active": engine.current_active()}

    cands = router_proxy.build_candidates(primary, settings)
    out = []
    for c in cands[:6]:
        rows = ranking.rank_endpoints(c["model"], settings["mix"],
                                      {"min_tps": settings["min_tps"],
                                       "min_uptime": settings["min_uptime"]})
        ep = next((r for r in rows if r["provider"] == c["provider"]
                   and not (isinstance(r, dict) and "error" in r)), None)
        out.append({
            "model": c["model"],
            "provider": c["provider"],
            "healthy": bool(ep and ep["healthy"]),
            "tps": ep["tps"] if ep else None,
            "latency": ep["latency"] if ep else None,
            "uptime": ep["uptime"] if ep else None,
            "blended": ep["blended"] if ep else None,
        })
    return {"candidates": out, "active": engine.current_active()}


@app.get("/api/telemetry")
def api_telemetry():
    """Routing snapshots over time (blended $/M, provider)."""
    return {"points": store.load_telemetry()}


# ---------------------------------------------------------------- static --

@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/landing")
def landing():
    return FileResponse(STATIC_DIR / "landing.html")


@app.get("/style.css")
def style():
    return FileResponse(STATIC_DIR / "style.css", media_type="text/css")


@app.get("/app.js")
def js():
    return FileResponse(STATIC_DIR / "app.js", media_type="text/javascript")


@app.get("/logo.svg")
def logo():
    return FileResponse(STATIC_DIR / "logo.svg", media_type="image/svg+xml")
