---
title: store
tags:
  - pennyroute
  - modulo
file: pennyroute/store.py
---

# store — `pennyroute/store.py`

Persistenza su file JSON e valori di default. Non importa altri moduli del pacchetto. Schema dei file in [[File dati]].

## Percorsi

`DATA_DIR` = `<repo>/data`, creata **all'import** del modulo (`mkdir(parents=True, exist_ok=True)`). È in `.gitignore`.

```
MODELS_FILE    data/models.json
CHAINS_FILE    data/chains.json
SETTINGS_FILE  data/settings.json
EVENTS_FILE    data/events.jsonl
TELEMETRY_FILE data/telemetry.json    TELEMETRY_MAX = 288  (24 h a 5 min)
```

## Primitive

| Funzione | Riga | Cosa fa |
|---|---|---|
| `_read_json(path, default)` | 150 | Ritorna `default` se il file manca o è JSON rotto |
| `_write_json(path, data)` | 158 | Scrive `<file>.tmp` poi `os.replace` (atomico), `indent=2`, `ensure_ascii=False` |

Sono "private" ma importate da [[providers]] e [[keys]]: sono di fatto l'API condivisa di persistenza.

## Funzioni per dominio

| Dominio | Funzioni |
|---|---|
| Watchlist | `load_models`, `save_models`, `add_model(slug, note)`, `remove_model(slug)` |
| Preset | `list_presets`, `preset_models(name)`, `load_presets` (non usata) |
| Catene | `load_chains`, `save_chains`, `normalize_chain(entry)` |
| Impostazioni | `load_settings`, `save_settings` |
| Eventi | `log_event(kind, detail)`, `load_events(limit)` |
| Telemetria | `push_telemetry(point)`, `load_telemetry(limit)` |

## Default (usati quando il file non esiste)

- `DEFAULT_MODELS` — 16 modelli flash/mini.
- `DEFAULT_CHAINS` — `free-first` (non primaria, `auto_apply: false`) e `main` (primaria, `auto_apply: true`, un solo step `cheapest`).
- `DEFAULT_SETTINGS`:

```python
{"mix": {"in": 0.14, "cache": 0.85, "out": 0.01},
 "min_tps": 45, "min_uptime": 99.0, "interval_min": 5, "gateway_restart": True}
```

`load_settings` unisce il file sopra i default, quindi una chiave nuova aggiunta a `DEFAULT_SETTINGS` compare da sola anche con un `settings.json` vecchio.

## Preset

`PRESETS` (riga 45) è una lista nel codice: `frugal`, `balanced`, `premium`, `free`. Applicare un preset **sostituisce** l'intera watchlist.

> [!warning]
> Il preset `free` ha `models: []`. Vedi [[Insidie note#Il preset free svuota la watchlist]].

## Migrazione a caricamento

`normalize_chain` (riga 191) converte il vecchio campo `provider: "X"` in `providers: ["X"]` per ogni step. Avviene a ogni `load_chains`; il file viene riscritto nel nuovo formato solo al primo salvataggio. È il modello da seguire per cambi di schema: vedi [[Convenzioni e vincoli]].

## Eventi

`log_event` aggiunge una riga a `events.jsonl`: `{"ts": "...", "event": kind, ...detail}`. Tipi emessi oggi:

| Evento | Da | Campi |
|---|---|---|
| `switch` | [[engine]] | `from`, `to`, `reason`, `blended` |
| `apply` | [[engine]] | `model`, `provider`, `gateway` |
| `engine_error` | [[engine]] | `error` |
| `proxy_skip` | [[router_proxy]] | `model`, `provider`, `reasons` |
| `proxy_error` | [[router_proxy]] | `error` |
| `preset` | [[app]] | `preset`, `count` |
| `bulk_add` | [[app]] | `added`, `skipped` |
| `primary` | [[app]] | `chain` |

`events.jsonl` cresce senza limite: non c'è rotazione. `load_events` legge tutto il file a ogni chiamata.

## Locking

`_lock` copre solo la singola scrittura. Le sequenze leggi-modifica-scrivi (`add_model`, `remove_model`, e tutte le rotte catene in [[app]]) **non** sono atomiche: due richieste concorrenti possono perdere un aggiornamento. `push_telemetry` invece tiene il lock per tutta la sequenza.

Collegate: [[File dati]], [[providers]], [[keys]], [[engine]]
