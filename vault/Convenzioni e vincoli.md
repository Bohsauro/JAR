---
title: Convenzioni e vincoli
tags:
  - pennyroute
  - convenzioni
---

# Convenzioni e vincoli

Regole ricavate dal codice e dalle spec in `docs/V2-SPEC.md` e `docs/V2-FRONTEND-SPEC.md`. Le spec descrivono il lavoro v2.0 già fatto: restano utili come dichiarazione d'intenti, non come lista di cose da fare.

## Vincoli dichiarati nelle spec

- **Zero build.** SPA vanilla JS. Niente `npm`, niente bundler, niente nuove dipendenze runtime (libreria standard Python + `httpx` + `fastapi`).
- **Persistenza.** Ogni nuovo file JSON usa il lock e la scrittura atomica di [[store]].
- **Formati intoccabili.** `data/keys.json`, `data/telemetry.json`, `data/events.jsonl`.
- **API solo additive.** Ogni endpoint esistente deve continuare a funzionare.
- **Migrazioni nel codice.** Se cambia lo schema di un `data/*.json`, si normalizza a caricamento (come `store.normalize_chain`). Mai modificare i file dati a mano.
- **Engine stabile.** Il comportamento di auto-apply dell'[[engine]] resta com'è.
- **Design.** Tela `#09090b`, accento `#3ecf8e`, numeri in mono, pannelli traslucidi, bordi `rgba(255,255,255,.06)`, raggi piccoli. Nuovi componenti = nuove classi in `static/style.css` con le variabili CSS esistenti. Nessun nuovo font.

## Convenzioni del codice Python

- **Gli errori di rete non sono eccezioni.** [[orclient]] ritorna `list` in caso di successo e `{"error": ...}` in caso di fallimento. I chiamanti controllano con `isinstance`.
- **Mai far cadere il router.** `except Exception` con `# noqa: BLE001` nei punti best-effort: ciclo dell'engine, stima della spesa, registrazione usage, failover del proxy.
- **Docstring di modulo** in testa a ogni file con lo scopo e le regole principali.
- **Commenti di sezione** in `app.py` nella forma `# ----- nome ---`.
- **Dati come `dict` e `list`**, niente dataclass né modelli di dominio. Pydantic solo per i body in ingresso.
- **Lettura difensiva**: `x.get(k) or {}`, `isinstance(entry, dict)` ovunque si leggono file JSON.
- **Soglie come dict** `gates = {"min_tps": ..., "min_uptime": ...}` passato insieme a `mix`.
- Type hint presenti ma non completi. Nessun formatter o linter configurato nel repo.

## Convenzioni del frontend

- Una funzione `viewX()` per pagina: scrive `#view` con `innerHTML`, poi collega gli handler con `onclick`.
- Selettori con `$` e `$$`. Chiamate con `api()`. Notifiche con `toast()`.
- Ogni valore dinamico nell'HTML passa per `esc()`.
- Stato in variabili globali maiuscole, ricaricate a mano dopo ogni scrittura.
- Grafici (sparkline, donut) disegnati come SVG a mano, nessuna libreria.

## Git

- Lavoro diretto su `main`.
- Messaggi di commit descrittivi, non Conventional Commits. I rilasci iniziano con `vX.Y.Z — …`, le modifiche puntuali con `Area: …` (es. `Overview: …`, `Chat/API: …`).

## Test

`tests/` usa `unittest` della libreria standard (nessuna dipendenza in più, coerente con il vincolo "zero nuove dipendenze"). I test non toccano mai `data/`: sostituiscono `providers.REGISTRY_FILE` e `USAGE_FILE` con file temporanei.

```bash
python -m unittest discover tests
```

## Verifiche manuali (dalle spec, non automatizzate)

```bash
python -c "from pennyroute import app"
```

```bash
node --check static/app.js
```

Poi un uvicorn di prova su una porta diversa da 8490 e qualche `curl` sugli endpoint toccati. Attenzione agli effetti collaterali dell'engine: [[engine]].

Collegate: [[Dove modificare]], [[Insidie note]], [[Frontend SPA]]
