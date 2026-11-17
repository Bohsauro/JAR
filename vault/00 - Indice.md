---
title: PennyRoute — Indice del vault
tags:
  - pennyroute
  - moc
versione: 2.0.0
commit: d2900a6
aggiornato: 2026-11-15
---

# PennyRoute — mappa della codebase

Router AI "frugale" per OpenRouter: classifica ogni coppia modello × provider per **costo blended** sul tuo mix reale di token, scarta gli endpoint non sani, e instrada sempre sul più economico sano, con catene di fallback. Backend FastAPI, SPA vanilla JS senza build, stato in file JSON.

> [!info] Come usare questo vault
> Prima di una modifica: leggi [[Dove modificare]] per trovare i file, poi [[Insidie note]] per non rompere nulla, poi la nota del modulo.
> I riferimenti `file:riga` valgono per il commit `d2900a6` (v2.0.0) più le due correzioni del 2026-11-15 a `providers.py` e `router_proxy.py`. Dopo modifiche grosse vanno riallineati.

## Visione d'insieme

- [[Architettura]] — moduli, dipendenze, i due percorsi di routing
- [[Flusso richiesta v1]] — cosa succede a una `POST /v1/chat/completions`
- [[Concetti]] — glossario: blended, health gate, watchlist, chain, candidato

## Moduli backend (`pennyroute/`)

| Nota | File | Righe | Ruolo |
|---|---|---|---|
| [[app]] | `app.py` | 548 | Rotte FastAPI, modelli Pydantic, file statici |
| [[router_proxy]] | `router_proxy.py` | 264 | Proxy OpenAI-compatibile con failover per richiesta |
| [[engine]] | `engine.py` | 149 | Thread in background: valuta la catena primaria e riscrive la config Hermes |
| [[notify]] | `notify.py` | 45 | Webhook `PENNY_WEBHOOK_URL` quando cambia la scelta della primaria |
| [[ranking]] | `ranking.py` | 149 | Costo blended, health gate, risoluzione catena |
| [[providers]] | `providers.py` | 314 | Registro provider, limiti, contatori di utilizzo |
| [[orclient]] | `orclient.py` | 201 | Client OpenRouter con cache in memoria, classificazione catalogo |
| [[store]] | `store.py` | 266 | Stato JSON persistente, default, preset |
| [[keys]] | `keys.py` | 79 | Chiavi API `pnk-…` (hash sha256) |

## Superfici

- [[API HTTP]] — tutti gli endpoint `/v1/*` e `/api/*`
- [[Frontend SPA]] — `static/app.js`, viste, stato globale, design system
- [[File dati]] — schema di ogni file in `data/`
- [[Deploy e configurazione]] — installer, systemd, chiave OpenRouter, Hermes
- File open source (2026-11-16, rebrand JAR): `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `.github/` (CI con unittest su Python 3.10/3.12 + `node --check` + build Docker, template issue/PR). Il README va tenuto allineato a variabili `PENNY_*`, file in `data/` e rotte in `app.py`

## Prima di modificare

- [[Dove modificare]] — ricette "voglio cambiare X → tocca Y"
- [[Convenzioni e vincoli]] — regole della casa (zero build, scritture atomiche, API solo additive)
- [[Insidie note]] — bug probabili, effetti collaterali, codice morto

## Numeri

- ~2.000 righe Python, 1.442 righe JS (`static/app.js`), 482 righe CSS
- 5 dipendenze: `fastapi`, `uvicorn[standard]`, `pydantic`, `PyYAML`, `httpx`
- Test: `tests/test_regressions.py` (3 test, `unittest`). Nessuna CI nel repo
