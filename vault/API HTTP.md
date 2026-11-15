---
title: API HTTP
tags:
  - pennyroute
  - api
---

# API HTTP

Tutte le rotte sono in `pennyroute/app.py` ([[app]]). Porta di default 8490.

- `/v1/*` richiede una chiave `pnk-…` in `X-API-Key` oppure `Authorization: Bearer …`.
- `/api/*` **non** richiede autenticazione.
- Errori: `HTTPException` di FastAPI → `{"detail": "..."}`. Nessun envelope comune: ogni rotta ha la sua forma.

## `/v1` — compatibile OpenAI

| Metodo | Percorso | Note |
|---|---|---|
| POST | `/v1/chat/completions` | Vedi [[Flusso richiesta v1]]. Body non-oggetto → 400 |
| GET | `/v1/models` | Elenco: modello servito ora dalla primaria (`owned_by: pennyroute-primary`), poi `penny` (`pennyroute-chain-primary`), poi `penny:<nome>` per ogni catena non primaria (`pennyroute-chain`), poi la watchlist (`pennyroute`) |

## Stato e routing

| Metodo | Percorso | Risposta |
|---|---|---|
| GET | `/api/state` | `{active, primary_chain, settings, model_count, providers: {tracked, exhausted}}` |
| GET | `/api/rank?force=` | `{models: [riga modello], mix}` — vedi [[ranking#Forma dei dati]] |
| GET | `/api/endpoints/{slug}?force=` | `{slug, mix, endpoints: [riga endpoint + available]}` |
| GET | `/api/resolve` | `{resolution, key_count}` — cosa servirebbe ora la primaria |
| GET | `/api/pipeline` | `{candidates: [{model, provider, healthy, tps, latency, uptime, blended}], active}` — primi 6 candidati |
| GET | `/api/telemetry` | `{points: [{ts, model, provider, blended}]}` |
| GET | `/api/events?limit=60` | `{events: [...]}` dal più recente |
| POST | `/api/evaluate` | Esegue subito `engine.evaluate_primary()` — **può scrivere la config Hermes** |
| POST | `/api/apply` | Body `{model, provider}` → `engine.apply_choice` — **scrive la config Hermes** |

## Catalogo e watchlist

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/catalog` | Parametri `q, tier, family, tag, sort, limit, offset`. Risposta `{total, results: [voce + wl], facets: {tiers, families, tags}}`. In caso di errore OpenRouter ritorna `{error}` con status 200 |
| GET | `/api/models` | `{models: [{slug, note}]}` |
| POST | `/api/models` | Body `{slug, note?}`. 400 slug vuoto, 409 già presente |
| POST | `/api/models/bulk` | Body `{slugs: [...]}` → `{ok, added, skipped}`. Non fallisce mai |
| DELETE | `/api/models/{slug}` | 404 se assente. Lo slug contiene `/` (rotta `{slug:path}`) |
| GET | `/api/presets` | `{presets: [{name, label, description, models: [slug]}]}` |
| POST | `/api/presets/{name}` | **Sostituisce** la watchlist. 404 se il preset non esiste |

Non esiste una rotta per modificare la nota di un modello: la SPA fa DELETE + POST.

## Catene

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/chains` | `{chains: [...]}` con step normalizzati |
| POST | `/api/chains` | Body `ChainIn {name, auto_apply, note, entries}`. Sempre `primary: false`. 409 nome esistente |
| PUT | `/api/chains/{name}` | Sostituisce `auto_apply, note, entries`; conserva `primary`. Il nome non si può cambiare |
| POST | `/api/chains/{name}/primary` | Rende primaria questa, toglie il flag alle altre |
| DELETE | `/api/chains/{name}` | 400 se è la primaria ed esistono altre catene. Nome inesistente → `{ok: true}` |

## Provider

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/providers` | `{providers: [{name, note, blocked, limits, usage, status}]}`, non disponibili prima |
| PUT | `/api/providers/{name}` | Upsert. Body `{note?, blocked?, limits?}`. Body `{}` crea una voce vuota |
| DELETE | `/api/providers/{name}` | 404 se assente. Non cancella l'usage |
| POST | `/api/providers/{name}/reset` | Azzera i contatori. 404 se non è nel registro |

Forma di `limits`: `{"requests": {"per": "day", "max": 1000}, "spend": {"per": "month", "max": 5}}`. Regole in [[providers#Regole dei limiti]].

## Impostazioni e chiavi

| Metodo | Percorso | Note |
|---|---|---|
| GET | `/api/settings` | Impostazioni complete (default + file) |
| PUT | `/api/settings` | Body parziale `{mix?, min_tps?, min_uptime?, interval_min?, gateway_restart?}`. `mix` non è validato |
| GET | `/api/keys` | `{keys: [{id, name, prefix, created, last_used}]}` |
| POST | `/api/keys` | Body `{name}` → `{id, name, key}` — chiave in chiaro, unica volta |
| DELETE | `/api/keys/{key_id}` | 404 se assente |

## File statici

`GET /` (SPA), `/landing`, `/style.css`, `/app.js`, `/logo.svg`.

Collegate: [[app]], [[Frontend SPA]], [[File dati]]
