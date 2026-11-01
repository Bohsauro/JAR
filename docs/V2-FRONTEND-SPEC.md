# PennyRoute v2.0 — Frontend Implementation Spec (PART 2)

Read the whole file before coding. Backend v2.0 is LIVE and already verified — the API
contract below is what the frontend consumes. Do NOT change any backend code. Only edit
`static/` (app.js, style.css, index.html, landing.html) and optionally README.md + docs/index.html
(copy only — no new screenshots).

## Live API contract (verified working — use exactly these shapes)

### GET /api/providers
```json
{"providers": [{
  "name": "Baidu",
  "note": "", "blocked": false,
  "limits": {"requests": {"per": "day", "max": 1000.0}},
  "usage": {"day": {"window": "2026-11-01", "requests": 3, "tokens_in": 300, "tokens_out": 20, "spend": 0.0005, "last_used": "..."},
            "month": {...}, "total": {...}},
  "status": {
    "blocked": false, "note": "", "last_used": "...",
    "requests": {"per": "day", "max": 1000.0, "used": 3.0, "pct": 0.3, "remaining": 997.0, "exhausted": false},
    "tokens": {...}, "spend": {...}     // only for configured limit types
  }
}]}
```
Sorted: unavailable/blocked first, then by day requests desc. `pct` is 0-100.

### PUT /api/providers/{name}  body: {"note"?, "blocked"?, "limits"?}
limits format: `{"requests": {"per": "day"|"month"|"total", "max": number}, "tokens": {...}, "spend": {...}}`
Returns {"ok", "provider"}. DELETE /api/providers/{name} → {"ok"}.
POST /api/providers/{name}/reset → {"ok"} (clears usage counters).

### GET /api/catalog  params: q, tier, family, tag, sort(price_asc|price_desc|name|ctx_desc), limit(≤200), offset
```json
{"total": 416, "results": [{"id": "nvidia/nemotron-ultra", "name": "...", "in": 2.5e-07, "out": 1e-06,
   "ctx": 262144, "family": "nvidia", "tier": "value", "tags": ["reasoning"],
   "in_$M": 0.25, "out_$M": 1.0, "wl": false}],
 "facets": {"tiers": {"free": 24, "budget": 203, "value": 91, "mid": 70, "premium": 21, "ultra": 7, "unknown": n},
            "families": {"openai": 30, ..., "other": 12}, "tags": {...}}}
```
`in`/`out` are per-token (display `in_$M`/`out_$M` as $/M). `wl` = already in watchlist.
Note: when tier/family/tag filtered, `results` are the FILTERED page but `facets` are computed on the FULL catalog.

### POST /api/models/bulk  body: {"slugs": ["a/b", "c/d"]} → {"ok", "added", "skipped"}
POST /api/models {slug, note} — single add. DELETE /api/models/{slug:path}.

### GET /api/chains  → {"chains": [{name, primary, auto_apply, note, entries: [
   {"type": "model", "model": "nvidia/nemotron-ultra", "providers": ["NVIDIA NIM", "OpenRouter"], "note": "..."},
   {"type": "cheapest", "filter": ":free", "providers": ["Groq"]}]}]}
POST /api/chains {name, auto_apply, note, entries} | PUT /api/chains/{name} same | POST /api/chains/{name}/primary | DELETE /api/chains/{name}
Entry semantics: model WITHOUT providers = auto (cheapest healthy of all providers);
model WITH providers = ordered hard preference (first available+healthy wins; step skipped if none);
cheapest WITH providers = restrict the cheapest pick to those providers.

### GET /api/endpoints/{slug}  — rows now carry "available": bool (provider not blocked/exhausted)
GET /api/state — additive "providers": {"tracked": n, "exhausted": n}
GET /api/resolve, /api/pipeline, /api/telemetry, /api/events, /api/settings, /api/keys, /api/presets — unchanged.

## Design language (STRICT — do not break it)
- Ultra-dark canvas #09090b, green accent #3ecf8e, Hanken Grotesk (--sans), mono for numbers.
- Existing components: .panel, .badge (ok/warn/bad/neut/info), .pill, .prov .dot, .pulse, .metric, .row-ctl, .field, .switch, .btn variants, .chain-node/.chain-flow/.chain-arrow, .ac-list, table styles.
- Add NEW classes under static/style.css for: .chip/.chips (provider chips), .gauge (limit progress bars), .facet (catalog filter chips with counts), .modal (edit dialog overlay), .bar-row (usage rows). Match the existing aesthetic: translucent panels, thin borders rgba(255,255,255,.06), small radius, mono numbers.
- No new fonts, no new dependencies, no build step, no npm. Vanilla JS.

## Pages

### Nav (app.js NAV + ICONS)
Order: overview, ranking, catalog, chains, providers, api, chat, models, settings, events.
Add icons for catalog (grid/search) and providers (server/pulse). Labels: "Catalog", "Providers".

### NEW: Catalog page (viewCatalog)
Toolbar row: search input (debounced, q), tier chips row with counts (from facets.tiers: All, free, budget, value, mid, premium, ultra — count badge on each), family (select from facets.families, incl. "other"), tag chips (from facets.tags), sort select. Active filters highlighted.
Results table: Model (id + name), Tier (badge, color-coded: free=green, budget=blue, value=teal?, mid=amber, premium=orange, ultra=red, unknown=gray — pick from existing palette vars), Family, ctx (k), $/M in/out (fmt), tags (small chips), action: [+ Add] button or "✓ in watchlist" badge (when wl=true).
"Add all (N) filtered" button (uses POST /api/models/bulk with the filtered ids — fetch all ids for the current filter set: loop pages until total reached, or request limit=200&offset repeatedly; do it client-side with a small loop; show toast with added/skipped).
Pagination: "Load more" button incrementing offset by limit (keep limit=50).
After any add → refresh RANKED + models (loadCommon-ish) so ranking/overview reflect it.

### NEW: Providers page (viewProviders)
Panel with search/filter box (client-side filter by name).
Table columns: Provider (name + note below), Status badge (blocked → "BLOCKED" bad; any limit exhausted → "EXHAUSTED" bad; limits configured → "OK" ok; no limits → "no limits" neut), Day R: used/max with gauge + remaining, Day Tokens: same, Day spend: same (USD, 4 decimals), Reset in (time to local midnight for day-window limits; month end for month-window; "—" for total), Last used, actions: [⛔ Block / ✓ Unblock] toggle, [Reset usage], [Edit].
Day gauges come from status.requests/tokens/spend (used/max/pct/remaining); only render a column when the provider has that limit type; if no limits → show note "configure limits via Edit".
EDIT MODAL (overlay .modal): fields per limit type — enabled checkbox + per select (day/month/total) + max input; note textarea; Save → PUT. Also "Delete provider entry" (danger, confirm) → DELETE.
Row expansion (click provider name) shows month + total windows tables (requests, tokens in/out, spend).
Sort: keep backend order; client search filters.

### Chains page upgrade (viewChains/renderChains/saveChain/chainAction/fillProviders)
- Chain header: keep PRIMARY/auto-apply badges; ADD editable note: a textarea under the h2, saved on change (PUT with chain incl. note; toast "Note saved"). Show only for chains with note OR on focus (placeholder "Add a note…").
- Flow diagram (.chain-flow): for model entries with providers, render `#i | model` with the provider chips inline (e.g. `deepseek-v4-flash → [Baidu] [DeepInfra]`); chips get a status dot: green = available, red dot = exhausted/blocked (from GET /api/providers status — build a name→available map; if provider unknown → gray). For cheapest entries render as today.
- Entries list rows: for model entries show the ordered provider chips with ✕ to remove (save immediately); an [+ provider] button next to each model entry opens a small dropdown (reuse .ac-list pattern) listing that model's endpoints (from GET /api/endpoints/{slug}) — show `provider — $blended/M` + availability dot; click appends to the providers list (if not present) and saves.
- Entry note: small inline text input per entry (placeholder "note…"), saved on change.
- Cheapest entries: optional "+ restrict" chips using the same mechanism (providers field).
- Keep everything else (add-step autocomplete, up/down/del, primary, delete chain, auto-apply switch, + Cheapest).

### Overview strip (viewOverview/loadOverview side panel)
Add a panel "Provider usage" in ov-side: from GET /api/providers take top 4 by day requests (or first 4 with limits), each row: name + day requests gauge (pct of max) + remaining; exhausted/blocked providers show red "EXHAUSTED" badge. If no providers configured show empty state hint linking to #/providers.
Also metrics row: replace "Watchlist" metric sub text… keep as is. (Minimal, don't break existing layout.)

### Models page (viewModels)
Make the note column editable: click note → inline input → PUT via POST /api/models is add-only; add a small feature: save note via POST /api/models/{slug}/note? NOT available in backend. Instead use: DELETE + re-ADD with note (`POST /api/models {slug, note}` after DELETE) — acceptable one-liner; or leave notes read-only if too invasive. (Prefer the DELETE+ADD trick ONLY if trivial; otherwise leave notes read-only — no backend changes allowed.)

### Chat / API / Settings / Events / Ranking
Keep as-is. (Ranking already shows notes + providers; fine.)

## Copy updates (README only, no new screenshots)
README.md: add "v2.0" feature bullets: full classified catalog (tiers/families/tags), provider budgets & usage tracking (requests/tokens/spend limits, auto-skip when exhausted), multi-provider ordered chain steps, per-provider GUI with remaining gauges.
docs/index.html + static/landing.html: add one line to features about provider budgets + catalog (keep the existing copy style).

## Acceptance checks (run at the end, fix failures before finishing)
1. `node --check static/app.js` — must pass (syntax).
2. Start nothing new: the live backend is on :8490 (do NOT restart it, do NOT run scratch — read-only usage).
3. Load every page in the SPA (they render via hash routes; verify by opening http://127.0.0.1:8490/ and clicking through the nav in a browser — you may use `curl http://127.0.0.1:8490/` only for the shell; real check: open in browser and check for JS errors).
4. Providers page: PUT a test provider via API (e.g. curl) with limits, then confirm the page renders its gauges; then DELETE it (leave clean state).
5. Do not commit. Report: files changed with line counts + checks results.