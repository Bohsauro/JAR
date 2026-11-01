# PennyRoute v2.0 — Implementation Spec

Authoritative spec for the v2.0 upgrade. Read it fully before touching code.
Implement PART 1 (Backend) exactly as specified here; PART 2 (Frontend) in a later pass
(maintains backward compatibility with the backend contract below).

Current state: v1.6.0, ~3k LOC. FastAPI app in `pennyroute/`, zero-build vanilla-JS SPA in `static/`,
JSON state in `data/`. Design system "High-End Developer Tool": ultra-dark (`--bg:#09090b`), green
accent (`--green:#3ecf8e`), Hanken Grotesk, no generic card soup. KEEP this design language.

Goals (user requirements):
1. Track ALL OpenRouter models, not just a cheap watchlist — full catalog divided into categories.
2. Fallback chains with MULTI-PROVIDER steps: ordered provider lists per step, e.g.
   nemotron-ultra step = [NVIDIA NIM (free quota) → OpenRouter (free) → OpenRouter (paid)]; when a
   provider's quota/limit runs out the chain automatically moves to the next provider.
3. Notes on chains, providers, models.
4. Per-provider limits: max requests, max tokens, max spend (per day/month/total), enforced by the router.
5. GUI showing for each provider "how much of the limit is left" + usage gauges.
6. General GUI improvement: new pages, better chains editor.

---

## PART 1 — BACKEND (Python, `pennyroute/`)

### 1.1 New data files

**`data/providers.json`** — user-configured provider registry (limits, notes, hard block).
Never auto-written by the router; only via API. Key = exact OpenRouter `provider_name` string.
```json
{
  "NVIDIA NIM": {
    "note": "Free tier ~1000 req/day",
    "blocked": false,
    "limits": {
      "requests": {"per": "day", "max": 1000},
      "tokens":   {"per": "day", "max": 2000000},
      "spend":    {"per": "day", "max": 5.0}
    }
  }
}
```
- `limits` keys: `requests` | `tokens` | `spend` (USD). All optional; absent = unlimited.
- `per`: `"day"` | `"month"` | `"total"`. Each limit type has its own `per`.
- `blocked: true` = hard manual block (provider never used, regardless of limits).
- `note`: free text, optional.

**`data/usage.json`** — auto-recorded counters per provider (never hand-edited).
```json
{
  "NVIDIA NIM": {
    "day":   {"window": "2026-11-01", "requests": 12, "tokens_in": 340000, "tokens_out": 12000, "spend": 0.0, "last_used": "2026-11-01T14:32:05"},
    "month": {"window": "2026-11", "requests": 300, "tokens_in": 9000000, "tokens_out": 400000, "spend": 0.42, "last_used": "2026-11-01T14:32:05"},
    "total": {"requests": 812, "tokens_in": 24000000, "tokens_out": 1100000, "spend": 1.13, "last_used": "2026-11-01T14:32:05"}
  }
}
```
- `day.window` = `YYYY-MM-DD`; `month.window` = `YYYY-MM`; `total.window` = `"all"`.
- Window resets automatically: on write, if stored window != current window, start a fresh counter at 0.

### 1.2 New module `pennyroute/providers.py`

Public functions (all thread-safe with an internal `threading.Lock`):

- `load_registry() -> dict` — providers.json content ({} default).
- `save_registry(reg: dict)` — atomic JSON write (same pattern as store.py `_write_json`).
- `get_provider(name: str) -> dict` — registry entry ({} if absent).
- `set_provider(name: str, patch: dict) -> dict` — upsert; patch keys: `note`, `blocked`, `limits`.
  Merge limits per limit-type. Return the merged entry. Invalid `per` values → ignore that limit type.
- `remove_provider(name: str) -> bool` — remove registry entry (usage file untouched).
- `load_usage() -> dict` / `save_usage(u: dict)` — usage.json.
- `reset_usage(name: str) -> bool` — zero all windows for provider in usage.json; False if provider had none.
- `record_usage(name: str, model: str, usage: dict | None, stream_ok: bool = True) -> None`
  Called after every successful proxied request. `usage` is the OpenAI `usage` object
  (`prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens`) — may be None for streams
  where usage could not be extracted; then count `requests` only (tokens 0, spend 0).
  Spend estimate (best effort, never crash): lookup endpoint pricing for (model, provider) via
  `orclient.fetch_endpoints_raw(model)` (10-min cache; on error → skip spend). Find the row whose
  `provider` matches. `cached = usage.prompt_tokens_details.get("cached_tokens", 0)`; prompt_new =
  prompt - cached. `spend = (in_price*prompt_new + cache_price*cached + out_price*completion) / 1e6`
  where in/cache/out are the $/M values from the row (already discount-adjusted). If the row's
  `cache_est` is True, the spend is an estimate — store it anyway (GUI marks ≈).
  Increments `day`, `month`, `total` windows (creating/rotating as per 1.1). Sets `last_used` = now.
- `is_available(name: str) -> dict`
  Returns `{"available": bool, "reasons": [str, ...]}` where reasons explain a block/exhaustion.
  Provider is UNAVAILABLE if: registry `blocked` → reason "blocked"; or for ANY limit type where
  current window `used >= max` → reason "requests/day exhausted" etc. Unknown providers (no registry
  entry, no limits) are always available.
- `limits_status(name: str) -> dict` — for the GUI: per limit type `{"per":..., "max":..., "used":...,
  "pct":..., "remaining":..., "exhausted": bool}` plus `"blocked"`, `"note"`, `"last_used"`. Used by
  the `/api/providers` endpoint.
- `overview() -> dict` — `{"tracked": n_registry, "exhausted": n_unavailable_due_to_limits_blocked}` —
  cheap summary for /api/state.

Window helpers: `_window(per)` returns `datetime.date.today().isoformat()` / `YYYY-MM` / `"all"`.
Exhaustion check uses `used >= max` (>=, so a fresh 0/max always available).

### 1.3 Full catalog with categories — `orclient.py` + `app.py`

Extend `fetch_catalog` (keep the same cache/TTL semantics, same route). Each catalog entry gains:
```python
{
  "id": "nvidia/nemotron-ultra", "name": "...", "in": 0.25, "out": 0.5, "ctx": 262144,
  "family": "nvidia",            # id.split("/")[0]
  "tier": "value",               # see rules
  "tags": ["reasoning"],         # see rules
  "in_$M": 0.25, "out_$M": 0.5   # prices converted to $/M (input already per-token in API → *1e6)
}
```
`in`/`out` stay per-token (as today); add `in_$M`/`out_$M` for display.

**Tier rules** (based on prompt $/M, missing price → `"unknown"`):
`0` → `free`; `< 0.5` → `budget`; `< 1.5` → `value`; `< 5` → `mid`; `< 15` → `premium`; else `ultra`.

**Tag rules** (lowercased `id + " " + name` substring match, first match wins, order matters):
- `reasoning`: `"r1"`, `"o1"`, `"o3"`, `"o4"`, `"thinking"`, `"reasoner"`
- `coding`: `"code"`, `"coder"`
- `vision`: `"vision"`, `" vl"`, `"multimodal"`  (note leading space on " vl" to avoid false hits)
- `embedding`: `"embed"`, `"ada"`
- `image`: `"image"`, `"dall-e"`, `"flux"`, `"sdxl"`, `"stable-diffusion"`, `"pixel"`
- `audio`: `"audio"`, `"whisper"`, `"tts"`, `"speech"`, `"music"`
- `agent`: `"agent"`
- none of the above → `[]`

**`GET /api/catalog`** (replace existing handler; keep query `q` working):
Query params: `q`, `tier`, `family`, `tag`, `sort` (`price_asc`|`price_desc`|`name`|`ctx_desc`), `limit` (default 50, max 200), `offset` (default 0).
Response:
```json
{
  "total": 468,
  "results": [ { ...catalog entry, "wl": false } ],
  "facets": {
    "tiers":    {"free": 12, "budget": 40, "value": 90, "mid": 120, "premium": 90, "ultra": 15, "unknown": 5},
    "families": {"openai": 30, "anthropic": 8, "deepseek": 12, ...},
    "tags":     {"reasoning": 60, "coding": 25, "vision": 40, "embedding": 10, "image": 25, "audio": 15, "agent": 5}
  }
}
```
`wl` = slug already in watchlist (`store.load_models()`). Facets are computed over the FULL catalog
(not the filtered page). Family facet: keep at most the top 30 families by count, plus `"other": N`.
Filter params combine with AND; `q` matches id or name substring (existing logic).

### 1.4 Chain steps with ordered provider lists — `ranking.py` + `store.py` + `app.py`

**Entry schema v2** (backward compatible — `provider` legacy field still accepted):
```json
{"type": "model", "model": "nvidia/nemotron-ultra", "providers": ["NVIDIA NIM", "OpenRouter"], "note": "free quota first"}
{"type": "cheapest", "filter": ":free", "providers": ["Groq"]}
```
- `providers`: ordered preference list. `provider` (legacy single) is normalized to `["provider"]` on
  load (add a `normalize_chain` helper in store.py, applied in `load_chains()` to every entry:
  if entry has `provider` and not `providers` → `providers=[provider]`, drop `provider`).
- `note`: optional free text on the ENTRY (and on the chain: `chain["note"]`).
- Semantics:
  - `model` entry WITHOUT `providers` → **auto**: cheapest healthy endpoint across all providers
    (today's behavior, unchanged).
  - `model` entry WITH `providers` → **ordered hard preference**: walk the list in order; first
    provider that (a) has a healthy endpoint for this model AND (b) `providers.is_available()` wins.
    If none → the whole step is skipped (NO fallback to auto inside the step) and the chain continues
    to the next entry.
  - `cheapest` entry WITH `providers` → the cheapest pick is restricted to those providers (only
    endpoints whose provider ∈ list AND available are eligible; if none eligible, skip entry).

**`ranking.resolve_chain`** — update to:
- Accept a `provider_ok` filter function (default: `lambda name: {"available": True}`) so callers can
  inject availability. Internal helper `_ep_ok(ep)` = `ep["healthy"] and provider_ok(ep["provider"])`.
- For `model` entries with `providers`: iterate providers in order; for each, find the row in
  `rank_endpoints(slug, ...)` matching provider AND `_ep_ok`; first hit → resolve
  `{"index", "type": "model", "model", "provider", "blended", "reason": "provider #N in step order"}`.
- Keep the legacy single-`provider` path working through the normalized field.
- For `cheapest` entries: filter pool models by `filter` (unchanged) AND by providers restriction
  (if entry has `providers`); pick first model with a best endpoint that is `_ep_ok` AND
  (if restricted) whose provider ∈ entry providers. Best endpoint selection: use `_best_endpoint`
  results but re-check `_ep_ok` on `m["best"]`.

**`router_proxy.build_candidates`** — update with identical semantics, expanding to ALL eligible
candidates (not just the winner), for per-request failover:
- `model` entry with `providers`: append one candidate per provider in order that has a healthy
  endpoint for the slug AND is available. (So the runtime tries NIM first, then OpenRouter, etc.)
- `model` entry without `providers` (auto): append ALL healthy endpoints (existing).
- `cheapest` entry: for each model in the filtered pool, append the best endpoint if eligible
  (existing behavior + providers restriction + availability).
- `build_candidates` and `resolve_chain` MUST route availability through the same shared function so
  engine auto-apply and the /v1 proxy agree. Add optional `settings` param already present; use
  `providers.is_available` inside (import providers module). No signature break — `is_available`
  reads fresh state each call (cheap, in-memory + file read is fine given 10-min cadence of engine /
  per-request cadence of proxy; file reads are small).

**Validation** (`app.py` `_validate_chain`): accept `providers` (list of str) and `note` (str) on
entries; `model` entry still requires non-empty `model`. Unknown entry types still rejected.

**`store.py`**: `DEFAULT_CHAINS` unchanged (they have no providers lists — fine). Add `note` default
`""` in `save_chains`? No — store what comes from API. `normalize_chain()` as above applied in
`load_chains`.

### 1.5 Usage recording + enforcement — `router_proxy.py`

- `_forward`: before sending each candidate, double-check `providers.is_available(cand["provider"])`
  — if unavailable, log a `proxy_skip` event and continue to next candidate.
- Record usage after success:
  - **Non-stream**: `record_usage(cand["provider"], cand["model"], data.get("usage"))` before
    returning `data` (and `data["pennyroute"]` gains `"provider_usage": {...}` — the limits_status
    for that provider — so clients can see remaining headroom; keep it small: `requests`, `tokens`,
    `spend` pct + remaining).
  - **Stream**: wrap `raw.aiter_bytes()` in a generator that buffers a rolling tail (keep last
    64 KB of decoded text; do NOT hold the whole stream). When the stream ends, regex-extract the
    last `"usage": {...}` JSON object from the tail (`re.search(r'"usage"\s*:\s*(\{[^{}]*\})', tail)`
    — usage objects are flat, so `[^{}]*` is safe) and call `record_usage` with it. If no usage
    found → `record_usage(provider, model, None)`. Also set `pennyroute.served_by` in the final
    SSE chunk (append a synthetic `data:` line before `[DONE]` if missing — best effort, do not
    break the stream on failure).
- The router counts ONLY successful requests (2xx). Failover attempts on 4xx/5xx do NOT consume quota.
- `build_candidates` already filters unavailable providers, so `_forward`'s re-check is a race guard.

### 1.6 API endpoints (`app.py`)

New/changed (version bump: `FastAPI(title="PennyRoute", version="2.0.0")`):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/providers` | — | `{"providers": [{name, note, blocked, limits, usage, status}]}` where `usage` = the usage windows dict, `status` = `providers.limits_status(name)`. Sorted: unavailable/blocked first, then by day requests desc. |
| PUT | `/api/providers/{name}` | `{"note"?, "blocked"?, "limits"?}` | `{"ok": true, "provider": {...merged}}` |
| DELETE | `/api/providers/{name}` | — | `{"ok": true}` |
| POST | `/api/providers/{name}/reset` | — | `{"ok": true}` (clears usage counters) |
| GET | `/api/catalog` | — | enriched catalog + facets (1.3) |
| POST | `/api/models/bulk` | `{"slugs": ["a/b", "c/d"]}` | `{"ok": true, "added": n, "skipped": n}` (adds watchlist entries, dedup, skip existing — no error on dup) |
| GET | `/api/state` | — | additive field `"providers": {"tracked": n, "exhausted": n}` |
| POST/PUT | `/api/chains` | `ChainIn` gains `note: str = ""`; entries accept `providers` | unchanged shape |

`GET /api/endpoints/{slug}` — additive field per row: `"available": provider_ok(name)` so the UI can
grey out exhausted providers (borrow `is_available`).

Do NOT change existing endpoint paths or response shapes except the additive fields listed.

### 1.7 Backend acceptance tests (run before declaring PART 1 done)

1. `python3 -c "import ast; [ast.parse(open(f'pennyroute/{m}.py').read()) for m in ['store','providers','orclient','ranking','router_proxy','app','engine','keys']]"` — all parse.
2. `python3 -c "from pennyroute import app"` — imports clean (run from repo root).
3. Start a scratch uvicorn on port 8499 (NOT 8490), then:
   - `curl -s 'http://127.0.0.1:8499/api/catalog?tier=free&limit=5'` → results have tier/tags/family/wl; facets present.
   - `curl -s 'http://127.0.0.1:8499/api/catalog?q=gemini&sort=price_asc'` → sane.
   - `curl -s -X PUT http://127.0.0.1:8499/api/providers/Groq -H 'content-type: application/json' -d '{"limits":{"requests":{"per":"day","max":1000}},"note":"test"}'` → ok.
   - `curl -s http://127.0.0.1:8499/api/providers` → entry present with status; pct 0.
   - `curl -s -X POST http://127.0.0.1:8499/api/providers/Groq/reset` → ok.
   - `curl -s http://127.0.0.1:8499/api/chains` → entries normalized (no legacy `provider` field if it existed; `note` intact).
   - Kill scratch server. Do NOT touch the real :8490 process.
4. If you changed an existing `data/*.json` schema, migrate in code (load-time normalization), never
   by hand-editing data files.
5. Run `git diff --stat` and sanity-check you only touched intended files.

## PART 2 — FRONTEND (static/, done in a later pass — READ ONLY for now)

Contract reminders for the frontend pass (do not implement now): pages `Catalog` and `Providers` are
new; nav order becomes Overview, Ranking, Catalog, Chains, Providers, API, Chat, Watchlist, Settings,
Events. Chains editor renders ordered provider chips per step with availability dots; chain and entry
`note` fields editable. Providers page = usage gauges per provider (requests/tokens/spend, day/month/
total tabs, remaining + reset-in, edit-limits modal, block toggle, reset button). Catalog = search +
tier/family/tag facet chips + sort + add-to-watchlist + "add all filtered". Overview gains a compact
provider-usage strip. All new UI uses existing CSS variables; add new component classes under
`static/style.css` keeping the design language; no new dependencies, no build step.

## Constraints (BOTH passes)

- Zero-build vanilla JS SPA. No npm, no bundler, no new runtime deps (Python stdlib + httpx + fastapi only).
- Use existing `store.py` locking/atomic-write patterns for all new JSON files.
- Never touch `data/keys.json`, `data/telemetry.json`, `data/events.jsonl` formats.
- The engine (`engine.py`) and its auto-apply behavior stay as-is (it will now simply never resolve
  to an exhausted provider because `resolve_chain` filters them).
- Keep every existing API endpoint working (additive changes only).
- Do not commit; leave the working tree with the changes for review.