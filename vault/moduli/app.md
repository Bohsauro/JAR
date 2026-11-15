---
title: app
tags:
  - pennyroute
  - modulo
file: pennyroute/app.py
---

# app — `pennyroute/app.py`

Punto d'ingresso FastAPI (`app = FastAPI(title="PennyRoute", version="2.0.0")`). Contiene **tutte** le rotte, i modelli Pydantic di input e il serving dei file statici. La logica vera sta negli altri moduli; qui c'è colla, più qualche pezzo di logica cresciuto in loco (filtri e facet del catalogo).

## Avvio

- `CORSMiddleware` con `allow_origins=["*"]`, tutti i metodi e header.
- `@app.on_event("startup")` → `engine.start()`: l'[[engine]] parte con il server.
- `STATIC_DIR` = `<repo>/static`.

## Autenticazione

`_require_key(request)` (riga 37) protegge **solo** `/v1/*`. Tutte le rotte `/api/*` e la UI sono senza autenticazione. Vedi [[Insidie note#API di gestione senza autenticazione]].

## Sezioni del file

| Righe | Sezione | Delega a |
|---|---|---|
| 43–82 | `/v1/chat/completions`, `/v1/models` | [[router_proxy]], [[ranking]] |
| 85–98 | `/api/state` | [[engine]], [[store]], [[providers]] |
| 101–161 | `/api/providers*` | [[providers]] |
| 164–247 | `/api/rank`, `/api/endpoints/{slug}`, `/api/catalog` | [[ranking]], [[orclient]] |
| 250–313 | `/api/models*`, `/api/presets*` | [[store]] |
| 316–391 | `/api/chains*` + `_validate_chain` | [[store]] |
| 394–411 | `/api/apply`, `/api/evaluate` | [[engine]] |
| 414–438 | `/api/settings` | [[store]] |
| 441–445 | `/api/events` | [[store]] |
| 448–486 | `/api/keys*`, `/api/resolve` | [[keys]], [[ranking]] |
| 489–521 | `/api/pipeline`, `/api/telemetry` | [[router_proxy]], [[store]] |
| 524–548 | `/`, `/landing`, `/style.css`, `/app.js`, `/logo.svg` | file statici |

Elenco completo con forma di richiesta e risposta: [[API HTTP]].

## Modelli Pydantic

`ProviderIn`, `ModelIn`, `ModelsBulkIn`, `ChainIn`, `ApplyIn`, `SettingsIn`, `KeyIn`. Validazione leggera: molti campi sono `dict` o `list[dict]` liberi. L'unica validazione strutturale è `_validate_chain` (riga 330): tipo step in `("model", "cheapest")`, `model` obbligatorio per step `model`, `note` stringa, `providers` lista di stringhe non vuote.

## Pattern ripetuto

Questo blocco compare in `v1_models`, `api_rank` e `api_resolve`, con varianti in `api_endpoints` e `api_pipeline`:

```python
settings = store.load_settings()
gates = {"min_tps": settings["min_tps"], "min_uptime": settings["min_uptime"]}
ranked = ranking.rank_models(store.load_models(), settings["mix"], gates)
primary = next((c for c in chains if c.get("primary")), None)
```

`v1_models` e `api_resolve` rifanno la stessa risoluzione della primaria. Se tocchi come si calcolano le soglie, cambiale ovunque.

## Logica che vive qui e non altrove

- **Catalogo** (`api_catalog`, riga 195): filtri `q/tier/family/tag`, ordinamenti `price_asc|price_desc|name|ctx_desc`, paginazione (`limit` 1–200, default 50), facet calcolate sul catalogo **intero** (non sul filtrato), famiglie oltre le prime 30 raggruppate in `other`, flag `wl` se il modello è in watchlist.
- **Ordinamento provider** (`api_providers`, riga 127): non disponibili prima, poi per richieste del giorno decrescenti.
- **Regola cancellazione catena** (riga 388): non si può cancellare la primaria se esistono altre catene.

## File statici

Serviti uno per uno con rotte esplicite, non con `StaticFiles`. Un nuovo asset in `static/` richiede una nuova rotta qui.

Collegate: [[API HTTP]], [[Architettura]], [[Dove modificare]]
