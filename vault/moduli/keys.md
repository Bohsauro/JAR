---
title: keys
tags:
  - pennyroute
  - modulo
  - sicurezza
file: pennyroute/keys.py
---

# keys — `pennyroute/keys.py`

Chiavi API per `/v1/*`. La chiave in chiaro è mostrata **una sola volta** alla creazione; su disco restano hash e prefisso.

## Formato

- Chiave: `"pnk-" + secrets.token_urlsafe(24)`
- Voce in `data/keys.json`:

```json
{"id": "<8 hex>", "name": "default", "prefix": "<primi 12 caratteri>",
 "hash": "<sha256 hex>", "created": "2026-01-01T12:00:00", "last_used": null}
```

## Funzioni

| Funzione | Riga | Cosa fa |
|---|---|---|
| `create_key(name)` | 25 | Crea e ritorna `{id, name, key}` (chiave completa) |
| `list_keys()` | 43 | `[{id, name, prefix, created, last_used}]`, mai l'hash |
| `revoke_key(key_id)` | 51 | Rimuove per id; `True` se esisteva |
| `verify_key(raw)` | 60 | Toglie `Bearer `, confronta l'hash, aggiorna `last_used` |
| `has_any_key()` | 78 | Non usata da nessuno |

## Dove viene usato

- `app._require_key` → `verify_key`, solo per `/v1/chat/completions` e `/v1/models`
- `app.api_keys`, `api_create_key`, `api_revoke_key` — **senza autenticazione**
- La SPA salva la chiave in `localStorage["penny_key"]` per la pagina Chat

## Note

- Nessuna scadenza, nessuno scope, nessun rate limit.
- `verify_key` **scrive `keys.json` a ogni richiesta valida** (per `last_used`), e lo fa rilasciando il lock tra lettura e scrittura: una revoca concorrente può essere annullata dalla riscrittura. Vedi [[Insidie note#Scrittura di keys.json a ogni richiesta]].
- Il confronto dell'hash usa `==`, non `hmac.compare_digest`.
- `import json` e `import os` non sono usati.

Collegate: [[app]], [[File dati]], [[Insidie note#API di gestione senza autenticazione]]
