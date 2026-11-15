---
title: providers
tags:
  - pennyroute
  - modulo
file: pennyroute/providers.py
---

# providers — `pennyroute/providers.py`

Registro dei provider configurati dall'utente e contatori di utilizzo registrati dal proxy. Introdotto in v2.0. Tutte le funzioni pubbliche sono thread-safe (`_lock` è un `RLock`).

## Due file

- `data/providers.json` — **registro**, scritto solo via API (`PUT /api/providers/{name}`).
- `data/usage.json` — **utilizzo**, scritto solo da `record_usage` e `reset_usage`.

Schema in [[File dati]].

## Costanti

```python
LIMIT_TYPES = ("requests", "tokens", "spend")
WINDOWS = ("day", "month", "total")
```

## Funzioni

| Funzione | Riga | Cosa fa |
|---|---|---|
| `load_registry` / `save_registry` | 26 / 32 | Lettura e scrittura del registro |
| `get_provider(name)` | 41 | Voce del registro o `{}` |
| `set_provider(name, patch)` | 51 | Upsert; `patch` con `note`, `blocked`, `limits` |
| `remove_provider(name)` | 89 | Cancella dal registro (non tocca l'usage) |
| `load_usage` / `save_usage` | 99 / 110 | Lettura (finestre scadute azzerate) e scrittura dei contatori |
| `reset_usage(name)` | 155 | Azzera le tre finestre; `False` se il provider non aveva usage |
| `record_usage(name, model, usage, stream_ok)` | 206 | +1 richiesta, + token, + spesa su day/month/total |
| `is_available(name)` | 249 | `{available, reasons}` |
| `limits_status(name)` | 278 | Stato per la UI: `blocked`, `note`, `last_used` + una voce per ogni limite |
| `overview()` | 313 | `{tracked, exhausted}` per `/api/state` |

## Regole dei limiti

- Un limite è `{"per": "day"|"month"|"total", "max": <numero>}`, uno per tipo (`requests`, `tokens`, `spend`).
- `set_provider` **unisce** per tipo: mandare solo `requests` non tocca `tokens`. Un tipo sconosciuto, un `per` non valido o un `max` non numerico vengono ignorati in silenzio. Non c'è modo via API di **rimuovere** un singolo limite (solo cancellare il provider).
- Esaurito quando `usato >= max`.
- `tokens` = `tokens_in + tokens_out` della finestra.

## Rotazione delle finestre

La chiave finestra è `YYYY-MM-DD` (day), `YYYY-MM` (month), `"all"` (total), calcolata con `datetime.date.today()` (ora locale del server).

`_rotated(win, per)` ritorna una finestra vuota se quella salvata ha una chiave diversa da quella corrente. Viene applicata in due punti:

- **in lettura**, dentro `load_usage`: ogni lettore vede le finestre scadute come azzerate, e ogni provider ha sempre le tre chiavi `day`, `month`, `total`;
- **in scrittura**, dentro `record_usage`: è il momento in cui il file su disco viene davvero aggiornato.

Quindi `usage.json` può contenere una finestra vecchia finché il provider non serve una nuova richiesta: è normale, in lettura non conta. Storia del bug in [[Insidie note#Limite giornaliero che non si sblocca]].

## Stima della spesa

`_estimate_spend` (riga 170), in ordine:

1. `usage["cost"]` se > 0 (OpenRouter lo riporta esatto).
2. Altrimenti: prezzi del provider da `orclient.fetch_endpoints_raw(model)` × token (`prompt − cached`, `cached`, `completion`).
3. Qualsiasi errore → `0.0`. Non solleva mai.

## Chi chiama cosa

- [[router_proxy]]: `is_available` (gate e race guard), `record_usage`, `limits_status`
- [[ranking]]: `is_available` (default di `provider_ok`)
- [[app]]: tutte le rotte `/api/providers*`, `overview` in `/api/state`, `is_available` in `/api/endpoints/{slug}`

## Note

- I nomi provider sono quelli di OpenRouter (`provider_name`), confronto esatto e case-sensitive. Un nome scritto diversamente nel registro non combacia mai e il limite non si applica.
- `record_usage` conta la richiesta anche se `usage` è `None` (stream senza blocco usage): +1 richiesta, 0 token, 0 spesa.
- Il parametro `stream_ok` non è usato.

Collegate: [[router_proxy]], [[ranking]], [[File dati]], [[Concetti#Disponibilità provider]]
