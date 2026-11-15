---
title: router_proxy
tags:
  - pennyroute
  - modulo
file: pennyroute/router_proxy.py
---

# router_proxy — `pennyroute/router_proxy.py`

Reverse proxy OpenAI-compatibile con failover per richiesta. Il percorso completo è descritto in [[Flusso richiesta v1]]; qui c'è il riferimento alle funzioni.

## Funzioni

| Funzione | Riga | Cosa fa |
|---|---|---|
| `_prov_ok(name)` | 24 | `providers.is_available(name)["available"]` |
| `build_candidates(chain, settings)` | 29 | Catena → lista ordinata `[{model, provider}]`, senza duplicati |
| `proxy_chat(request, body)` | 85 | Sceglie la catena dal campo `model`, costruisce i candidati, chiama `_forward` |
| `_forward(request, body, candidates)` | 125 | Prova i candidati in ordine; streaming o JSON |
| `_usage_from_tail(tail)` | 196 | Estrae l'ultimo oggetto `"usage"` da una coda di testo SSE (bilanciamento graffe) |
| `_provider_usage_summary(name)` | 221 | `{requests,tokens,spend: {per, pct, remaining}}` per il campo `pennyroute.provider_usage` |
| `_wrap_stream(raw, model, provider)` | 233 | Generatore: inoltra i chunk intatti, tiene coda di 64 KB in byte, registra usage nel `finally` |
| `StreamingResp` | 252 | `StreamingResponse` che possiede e chiude il client httpx |

## Usato da

- `app.v1_chat` → `proxy_chat`
- `app.api_pipeline` → `build_candidates` (mostra i primi 6 candidati della primaria)

## Dettagli da ricordare

- L'URL upstream `https://openrouter.ai/api/v1/chat/completions` è scritto **due volte** (righe 155 e 171), non è una costante.
- Il provider è fissato con `provider: {"order": [p], "allow_fallbacks": false}`: OpenRouter non può ripiegare da solo, il failover è tutto qui.
- Qualsiasi status ≥ 400 conta come fallimento del candidato, compresi 400 e 401 dovuti a una richiesta malformata: in quel caso si riprovano tutti i candidati e il client riceve un 502 generico. L'errore originale si perde.
- In streaming viene creato un `httpx.AsyncClient` per ogni tentativo; in caso di status ≥ 400 viene chiuso a mano. Un'eccezione in `client.send` salta al `except` senza chiudere il client.
- L'import di `StreamingResponse` è in fondo al file (riga 249), sopra la classe che lo usa.
- `import re` e `import time` non sono usati.
- `_wrap_stream` non deve mai decodificare e ricodificare i chunk: un carattere multibyte può cadere a cavallo di due chunk. La coda si decodifica una volta sola a fine stream. Storia in [[Insidie note#Stream non byte-puro]].

Collegate: [[ranking]], [[providers]], [[orclient]], [[Flusso richiesta v1]]
