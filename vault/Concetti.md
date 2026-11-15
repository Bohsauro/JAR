---
title: Concetti
tags:
  - pennyroute
  - glossario
---

# Concetti

## Costo blended

Prezzo per 1M di token totali, pesato sul mix reale dell'utente:

```
blended = in_f · input + cache_f · cache_read + out_f · output
```

Mix di default `{"in": 0.14, "cache": 0.85, "out": 0.01}` (carico agentico: quasi tutto cache-read). Calcolato in `ranking.rank_endpoints` (`pennyroute/ranking.py:39`). I prezzi sono già in $/M e già scontati (`discount`) da [[orclient]].

Se un provider non espone il prezzo cache, si usa il prezzo input (stima pessimistica) e la riga porta `cache_est: true` (mostrato come `≈` nella UI). Se manca il prezzo output, si usa il prezzo input.

## Health gate

Un endpoint è `healthy` solo se **entrambe** valgono (`pennyroute/ranking.py:40`):

- `tps` (throughput p50 ultimi 30 min) ≥ `min_tps` (default 45)
- `uptime` (ultimo giorno) ≥ `min_uptime` (default 99.0)

Valore mancante (`None`) = non sano.

## Disponibilità provider

Separata dalla salute. Un provider è `available` se non è `blocked` e nessun limite configurato è esaurito (`providers.is_available`). Provider non presenti nel registro sono sempre disponibili. Vedi [[providers]].

Un endpoint viene scelto solo se è **sano e disponibile**.

## Watchlist

Lista di modelli seguiti (`data/models.json`, voci `{slug, note}`). Gli step `cheapest` scelgono solo dentro la watchlist. Il catalogo completo OpenRouter è un'altra cosa: serve a cercare e aggiungere modelli.

## Catena di fallback (chain)

Lista ordinata di step (`entries`). Si percorre dall'alto: vince il primo step che produce un endpoint sano e disponibile.

| Tipo step | Campi | Significato |
|---|---|---|
| `cheapest` | `filter?`, `providers?`, `note?` | Il modello più economico sano della watchlist. `filter` è una sottostringa dello slug (es. `":free"`). `providers` restringe ai provider elencati. |
| `model` | `model`, `providers?`, `note?` | Modello fisso. Con `providers`: lista ordinata, vince il primo disponibile e sano. Senza: il più economico sano tra tutti. |

Una sola catena è **primaria** (`primary: true`): è quella che l'[[engine]] applica. Le altre sono ricette selezionabili per richiesta come `penny:<nome>`.

`auto_apply` (per catena): se `false` l'engine valuta ma non scrive la config.

## Candidato

Coppia `{model, provider}` prodotta da `router_proxy.build_candidates`. Il proxy li prova in ordine; l'utente non vede il cambio.

## Tier, family, tag (catalogo)

Classificazione calcolata in [[orclient]], non fornita da OpenRouter:

- **tier** dal prezzo input $/M: `free` (≤0), `budget` (<0.5), `value` (<1.5), `mid` (<5), `premium` (<15), `ultra`, `unknown` (prezzo assente)
- **family**: parte dello slug prima di `/`
- **tags**: al massimo **un** tag, il primo che combacia in `TAG_RULES` (reasoning, coding, vision, embedding, image, audio, agent)

Collegate: [[ranking]], [[router_proxy]], [[File dati]]
