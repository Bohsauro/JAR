---
title: ranking
tags:
  - pennyroute
  - modulo
file: pennyroute/ranking.py
---

# ranking — `pennyroute/ranking.py`

Calcolo puro: costo blended, health gate, classifica, risoluzione di una catena. Non scrive nulla. Definizioni in [[Concetti]].

## Funzioni

| Funzione | Riga | Ritorna |
|---|---|---|
| `_mix_tuple(mix)` | 21 | `(in, cache, out)` con default 0.14 / 0.85 / 0.01 |
| `rank_endpoints(slug, mix, gates, force)` | 27 | Endpoint di un modello, ordinati |
| `_best_endpoint(slug, mix, gates, force)` | 48 | `{slug, best, provider_count, healthy_count}` oppure `{slug, error}` |
| `rank_models(models, mix, gates, force)` | 63 | Watchlist ordinata per costo del miglior endpoint |
| `resolve_chain(chain, ranked, mix, gates, provider_ok)` | 90 | Primo step risolto, oppure `None` |

`gates` è sempre `{"min_tps": …, "min_uptime": …}` preso dalle impostazioni.

## Forma dei dati

**Riga endpoint** (da `rank_endpoints`): tutti i campi grezzi di [[orclient]] più `blended` e `healthy`; `out` mai `None` (ripiega su `in`).

```
provider, quant, in, cache, cache_est, out, discount, latency, tps, uptime, blended, healthy
```

In caso di errore di rete la lista è `[{"error": "…"}]`: **un solo elemento senza le altre chiavi**. Chi itera deve filtrare prima di leggere `r["provider"]`.

**Riga modello** (da `rank_models`): `{slug, note, best, provider_count, healthy_count}` oppure `{slug, note, error}`.

**Risoluzione** (da `resolve_chain`): `{index, type, model, provider, blended, reason}`.

## Ordinamenti

- Endpoint: sani prima, poi `blended` crescente, poi `tps` decrescente.
- `best` di un modello: il primo sano; se nessuno è sano, il primo in assoluto (quindi `best` può essere non sano: va sempre controllato `best["healthy"]`).
- Modelli: `best` sano (0) → senza `best` o errore (1) → `best` non sano (2); a parità, `blended` crescente.

## `resolve_chain`

Per ogni step, in ordine:

- **`cheapest`**: scorre la classifica (filtrata per sottostringa `filter`), salta chi non rispetta `providers`, ritorna il primo con `best` sano e provider disponibile.
- **`model` con `providers`**: prova i provider nell'ordine dato; vince il primo sano e disponibile. Se nessuno → lo step è saltato.
- **`model` senza `providers`**: prende `_best_endpoint`; vale solo se sano e disponibile. Non prova il secondo miglior endpoint se il primo ha il provider esaurito.

`provider_ok` è iniettabile (utile per test); il default usa `providers.is_available`.

## Costo e prestazioni

`rank_models` lancia fino a 8 thread, uno per modello, e ognuno può fare una chiamata HTTP a OpenRouter. Con cache calda (10 min) è istantaneo; a freddo con watchlist grande è lento e fa N richieste. `force=True` salta la cache (usato da "Refresh" nella pagina Ranking).

> [!warning]
> Le regole delle catene sono duplicate in `router_proxy.build_candidates`. Vedi [[Insidie note#Logica di catena duplicata]].

Collegate: [[orclient]], [[providers]], [[engine]], [[router_proxy]]
