---
title: Dove modificare
tags:
  - pennyroute
  - ricette
---

# Dove modificare

Ricette "voglio cambiare X → tocca Y". Prima di partire: [[Convenzioni e vincoli]] e [[Insidie note]].

## Routing e costo

| Voglio… | File e punto |
|---|---|
| Cambiare la formula del costo blended | `ranking.rank_endpoints` (`ranking.py:39`) |
| Cambiare cosa significa "sano" | `ranking.rank_endpoints` (`ranking.py:40`); nuove soglie anche in `store.DEFAULT_SETTINGS`, `app.SettingsIn`, `app.api_set_settings`, `viewSettings` in `app.js` |
| Cambiare l'ordine della classifica | chiavi di sort in `rank_endpoints` (`ranking.py:44`) e `rank_models` (`ranking.py:77`) |
| Aggiungere un tipo di step di catena | `ranking.resolve_chain` **e** `router_proxy.build_candidates` **e** `app._validate_chain` **e** l'editor (`chainEntryRow`, `chainAction` in `app.js`) |
| Cambiare come il campo `model` sceglie la catena | `router_proxy.proxy_chat` (`router_proxy.py:91`); aggiornare anche `app.v1_models` e la tabella nel README |
| Cambiare timeout o URL upstream | `router_proxy._forward` (URL ripetuto alle righe 155 e 171) |
| Aggiungere campi alla risposta `pennyroute` | `router_proxy._forward` (`router_proxy.py:177`), solo non-streaming |
| Cambiare cosa scrive in Hermes | `engine.apply_choice` (`engine.py:47`) |
| Cambiare la frequenza dell'engine | impostazione `interval_min`; il ciclo è `engine._loop` |

## Provider e limiti

| Voglio… | File e punto |
|---|---|
| Aggiungere un tipo di limite | `providers.LIMIT_TYPES`, `_used_for`, e i campi salvati in `_blank_window` / `record_usage`; poi `gaugeHtml`, `openEditModal` in `app.js` |
| Aggiungere una finestra (es. settimana) | `providers.WINDOWS`, `_valid_per`, `_window`, e i cicli `for per in ("day","month","total")` in `reset_usage` e `record_usage` |
| Cambiare la stima della spesa | `providers._estimate_spend` (`providers.py:170`) |
| Cambiare quando un provider è disponibile | `providers.is_available` (`providers.py:249`) — è l'unico punto, usato da engine e proxy |

## Catalogo e OpenRouter

| Voglio… | File e punto |
|---|---|
| Cambiare le soglie dei tier | `orclient._tier` (`orclient.py:125`) e `TIER_ORDER` in `app.js:397` |
| Aggiungere o correggere un tag | `orclient.TAG_RULES` (`orclient.py:114`) |
| Cambiare la durata della cache | `orclient.ENDPOINTS_TTL`, `CATALOG_TTL` |
| Leggere un campo in più da OpenRouter | `orclient.fetch_endpoints_raw` (riga endpoint) o `_catalog_entry` (voce catalogo) |
| Aggiungere un filtro o un ordinamento al catalogo | `app.api_catalog` (`app.py:195`) + `catParams`, `renderCatalogControls` in `app.js` |
| Cambiare dove si cerca la chiave OpenRouter | `orclient.get_key` (`orclient.py:25`) e `install.sh` passo 3 |

## Dati e default

| Voglio… | File e punto |
|---|---|
| Cambiare la watchlist di default | `store.DEFAULT_MODELS` |
| Aggiungere o modificare un preset | `store.PRESETS` (`store.py:45`) e la tabella nel README |
| Aggiungere un'impostazione | `store.DEFAULT_SETTINGS` + `app.SettingsIn` + la tupla in `app.api_set_settings` + `viewSettings` |
| Aggiungere un file di stato | costante `DATA_DIR / "x.json"` + `_read_json` / `_write_json` con un lock; aggiornare [[File dati]] |
| Cambiare lo schema di un file esistente | normalizzare a caricamento come `store.normalize_chain`; mai a mano |
| Registrare un nuovo tipo di evento | `store.log_event("tipo", {...})`; la pagina Events li mostra tutti |

## API e interfaccia

| Voglio… | File e punto |
|---|---|
| Aggiungere un endpoint | `app.py`, nella sezione giusta (commenti `# --- nome ---`); modello Pydantic accanto. Aggiornare [[API HTTP]] |
| Proteggere `/api/*` | oggi `_require_key` è chiamato a mano nelle due rotte `/v1`; servirebbe una dependency o un middleware in `app.py`, e la SPA dovrebbe mandare la chiave in `api()` (`app.js:24`) |
| Aggiungere una pagina alla SPA | funzione `viewX` + voce in `VIEWS` (`app.js:1415`) + voce in `NAV` (`app.js:55`) + icona in `ICONS` |
| Aggiungere un componente grafico | nuova classe in `static/style.css` con le variabili esistenti |
| Servire un nuovo file statico | nuova rotta in fondo ad `app.py` (non c'è `StaticFiles`) |
| Modificare il testo della landing | `static/landing.html` **e** `docs/index.html` |
| Cambiare versione | `pennyroute/__init__.py`, `app.py:23`, README |

## Prima di chiudere una modifica

1. `python -m unittest discover tests` dalla radice del repo (servono le dipendenze di `requirements.txt`). Per un bug nuovo: prima un test che fallisce in `tests/`, poi la correzione.
2. `python -c "from pennyroute import app"` dalla radice del repo.
3. `node --check static/app.js` se hai toccato il frontend.
4. Prova su porta diversa da 8490, con `auto_apply: false` sulla primaria per non toccare Hermes.
5. Aggiorna la nota del vault corrispondente e i riferimenti `file:riga` se sono slittati.

Collegate: [[00 - Indice]], [[Architettura]], [[Insidie note]]
