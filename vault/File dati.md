---
title: File dati
tags:
  - pennyroute
  - dati
---

# File dati — `data/`

Tutto lo stato è in `<repo>/data/`, in `.gitignore`. La cartella è creata all'import di [[store]]. Nessun file esiste finché non viene scritto la prima volta: fino ad allora valgono i default nel codice.

| File | Scritto da | Default | Contenuto |
|---|---|---|---|
| `models.json` | [[store]] | `DEFAULT_MODELS` | watchlist |
| `chains.json` | [[store]] | `DEFAULT_CHAINS` | catene di fallback |
| `settings.json` | [[store]] | `DEFAULT_SETTINGS` | mix, soglie, intervallo |
| `events.jsonl` | [[store]] | assente | log append-only |
| `telemetry.json` | [[store]] | `[]` | ultimi 288 snapshot di routing |
| `keys.json` | [[keys]] | `[]` | chiavi API (hash) |
| `providers.json` | [[providers]] | `{}` | registro provider |
| `usage.json` | [[providers]] | `{}` | contatori di utilizzo |

## `models.json`

```json
[{"slug": "deepseek/deepseek-v3.2", "note": "DeepSeek V3.2"}]
```

## `chains.json`

```json
[{
  "name": "main",
  "primary": true,
  "auto_apply": true,
  "note": "",
  "entries": [
    {"type": "cheapest", "filter": ":free", "providers": ["Groq"], "note": ""},
    {"type": "model", "model": "openai/gpt-5.4-mini", "providers": ["OpenAI", "Azure"]}
  ]
}]
```

Formato vecchio `"provider": "X"` accettato in lettura e convertito in `"providers": ["X"]`. Significato degli step: [[Concetti#Catena di fallback (chain)]].

## `settings.json`

```json
{"mix": {"in": 0.14, "cache": 0.85, "out": 0.01},
 "min_tps": 45, "min_uptime": 99.0, "interval_min": 5, "gateway_restart": true}
```

## `events.jsonl`

Una riga JSON per evento: `{"ts": "2026-01-01T12:00:00", "event": "<tipo>", ...}`. Tipi in [[store#Eventi]]. Nessuna rotazione.

## `telemetry.json`

```json
[{"ts": "2026-01-01T12:00:00", "model": "...", "provider": "...", "blended": 0.123}]
```

Buffer circolare di `TELEMETRY_MAX` = 288 punti. Scritto dall'[[engine]] a ogni ciclo con risoluzione e `auto_apply` attivo.

## `keys.json`

```json
[{"id": "a1b2c3d4", "name": "default", "prefix": "pnk-AbCdEfGh",
  "hash": "<sha256>", "created": "...", "last_used": null}]
```

## `providers.json`

```json
{"Groq": {"note": "free tier", "blocked": false,
          "limits": {"requests": {"per": "day", "max": 1000.0},
                     "spend": {"per": "month", "max": 5.0}}}}
```

## `usage.json`

```json
{"Groq": {
  "day":   {"window": "2026-01-01", "requests": 12, "tokens_in": 3400,
            "tokens_out": 210, "spend": 0.000812, "last_used": "2026-01-01T12:00:00"},
  "month": {"window": "2026-01", "...": "..."},
  "total": {"window": "all", "...": "..."}
}}
```

## Regole

- Scrittura sempre con `store._write_json` (atomica).
- Cambio di schema = normalizzazione a caricamento nel codice, mai modifica a mano dei file. Vedi [[Convenzioni e vincoli]].
- Le date sono stringhe in ora locale senza fuso (`time.strftime("%Y-%m-%dT%H:%M:%S")`).

## Fuori dal repo

- `~/.hermes/config.yaml` — letto e **scritto** dall'[[engine]].
- `~/.hermes/.env` — letto da [[orclient]] come ripiego per la chiave OpenRouter.
- `.env` nella directory di lavoro — chiave OpenRouter (in `.gitignore`).

Collegate: [[store]], [[providers]], [[keys]], [[Deploy e configurazione]]


## `tokenmix.json` (2026-11-17)

Lista JSON, ultime 500 richieste servite dal proxy: `{ts, kind: "chat"|"tools", chars, in, cached, out, model, provider}`. Scritto da [[tokenmix]] `observe()`. `settings.json` ha in più `mix_mode: "auto"|"manual"`.
