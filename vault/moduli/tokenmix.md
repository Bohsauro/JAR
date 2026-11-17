---
title: tokenmix
tags:
  - pennyroute
  - modulo
file: pennyroute/tokenmix.py
aggiornato: 2026-11-17
---

# tokenmix — mix token appreso e predetto per richiesta

Sostituisce il mix fisso (`settings.mix`) come base del costo blended.

## Apprendimento

- `observe()` è chiamata da `router_proxy._record` dopo ogni richiesta servita (anche streaming): salva in `data/tokenmix.json` `{ts, kind, chars, in, cached, out, model, provider}`, ultime 500 righe. Solo conteggi, mai contenuto.
- `effective(settings)`: con `mix_mode == "auto"` (default) e ≥ 20 righe usa il mix misurato (uncached in / cached / out), altrimenti `settings.mix`. Usata da [[app]], [[engine]], [[router_proxy]] al posto di `settings["mix"]`.

## Predizione (`predict`)

- input = caratteri prompt (+ `tools`) / chars-per-token, mediana calibrata sullo storico (default 4).
- output = mediana `completion_tokens` delle richieste dello stesso `kind` (`tools`/`chat`), cap `max_tokens`/`max_completion_tokens`.
- cached = prefisso di messaggi più lungo già inviato negli ultimi 600 s (hash sha256 in memoria, max 512). La cache vale solo sul provider che l'ha servita → `affinity [model, provider]`. Conversazione nuova: quota cache = quella del mix effettivo.

## Ordinamento (`order`)

`router_proxy._plan` = `build_candidates(chain, settings, pred.mix, pred.affinity)` poi `order()`. Dentro ogni step (mai tra step) riordina per costo reale della richiesta: token cached a prezzo cache solo sull'endpoint con affinità. Step con `providers` espliciti (`ordered: True`) restano in ordine. I candidati ora hanno `step`, `ordered`, `price`.

## Insidie

- Prefissi in memoria: un riavvio azzera le affinità (le cache dei provider scadono comunque in minuti).
- I test che passano per `_wrap_stream`/`_record` devono patchare `tokenmix.observe` o `tokenmix.LOG_FILE`, altrimenti scrivono in `data/`.
