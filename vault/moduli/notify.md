---
title: notify
tags:
  - pennyroute
  - modulo
file: pennyroute/notify.py
---

# notify — `pennyroute/notify.py`

Webhook unico per i cambi di rotta. Aggiunto il 2026-11-17.

- `route_changed(prev, cur)`: se `PENNY_WEBHOOK_URL` è impostata, fa una `POST` JSON con `text` e `content` (stesso messaggio: `text` per Slack/Telegram, `content` per Discord) più `event`, `from`, `to`, `blended`. Timeout 5 s.
- Non solleva mai. Un errore diventa l'evento `notify_error` con solo `status` o il nome dell'eccezione: **mai l'URL**, che contiene un token.

## Chi lo chiama

[[engine]] `evaluate_primary`: confronta `(model, provider)` risolti con l'ultimo punto di `store.load_telemetry(1)`. Diversi → notifica. Nessun punto precedente (primo avvio) → niente notifica. Funziona anche senza Hermes, a differenza dell'evento `switch`.

Anche `POST /api/evaluate` passa da qui, quindi può notificare.

## Limiti

- Chiamata sincrona nel thread dell'engine (o nel threadpool di FastAPI per `/api/evaluate`): un webhook lento ritarda il ciclo di al massimo 5 s.
- Formato Telegram e Discord non provato con un invio reale, solo da documentazione.

Test: `RouteChangeNotifications` in `tests/test_regressions.py`.
