---
title: orclient
tags:
  - pennyroute
  - modulo
file: pennyroute/orclient.py
---

# orclient — `pennyroute/orclient.py`

Client di sola lettura verso OpenRouter, con cache in memoria. Usa `urllib` della libreria standard (sincrono, bloccante). Non importa altri moduli del pacchetto.

## Chiave OpenRouter — `get_key()` (riga 25)

Ordine di ricerca:

1. variabile d'ambiente `OPENROUTER_API_KEY`
2. `.env` nella **directory di lavoro corrente** (`Path.cwd()`, non la cartella del repo)
3. `~/.hermes/.env`
4. stringa vuota (le chiamate partono senza header di autorizzazione)

Usata anche da [[router_proxy]] per le chat completions.

## Cache

`_cache` è un dict di processo protetto da `_lock`.

| Chiave | TTL | Contenuto |
|---|---|---|
| `ep:<slug>` | `ENDPOINTS_TTL` = 600 s | righe endpoint grezze di un modello |
| `catalog` | `CATALOG_TTL` = 3600 s | catalogo completo classificato |

Anche gli **errori** vengono messi in cache per l'intero TTL. `force=True` salta la lettura. La cache non ha limite di dimensione e si svuota solo al riavvio.

## Funzioni

| Funzione | Riga | Ritorna |
|---|---|---|
| `_get(url, timeout)` | 48 | JSON, oppure `{"__error": str}`. Non solleva mai |
| `fetch_endpoints_raw(slug, force)` | 67 | `list` di righe, oppure `{"error": str}` |
| `fetch_catalog(force)` | 173 | `list` di voci, oppure `{"error": str}` |
| `search_catalog(query, limit)` | 190 | Non usata da nessuno |

> [!important] Convenzione degli errori
> Nessuna eccezione: successo = `list`, fallimento = `dict` con chiave `error`. Ogni chiamante fa `isinstance(x, dict)` prima di iterare.

## Riga endpoint grezza

Da `GET /api/v1/models/<slug>/endpoints`, un elemento per provider:

| Campo | Origine | Note |
|---|---|---|
| `provider` | `provider_name` | endpoint senza nome scartati |
| `quant` | `quantization` | `""` se assente |
| `in` | `pricing.prompt` | $/M, scontato. Endpoint senza prezzo prompt scartati |
| `cache` | `pricing.input_cache_read` | $/M; se assente = `in` |
| `cache_est` | — | `True` se `cache` è stimato |
| `out` | `pricing.completion` | $/M oppure `None` |
| `discount` | `pricing.discount` | frazione, applicata come `1 − discount` |
| `latency` | `latency_last_30m.p50` | |
| `tps` | `throughput_last_30m.p50` | |
| `uptime` | `uptime_last_1d` | |

Lo slug è codificato con `urllib.parse.quote(slug, safe="/")`.

## Voce di catalogo

Da `GET /api/v1/models`:

```
id, name, in, out, ctx, family, tier, tags, in_$M, out_$M
```

`in` e `out` sono $/token (prezzo di listino), `in_$M` e `out_$M` sono $/M. `tier`, `family` e `tags` sono calcolati qui: regole in [[Concetti#Tier, family, tag (catalogo)]].

`TAG_RULES` (riga 114) lavora per sottostringa su `id + " " + name` in minuscolo, primo match vince. Sottostringhe corte come `"r1"`, `"o1"`, `"ada"` o `"code"` producono falsi positivi.

Collegate: [[ranking]], [[providers]], [[app]], [[Deploy e configurazione]]
