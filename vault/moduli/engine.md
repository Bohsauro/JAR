---
title: engine
tags:
  - pennyroute
  - modulo
file: pennyroute/engine.py
---

# engine — `pennyroute/engine.py`

Thread daemon che applica la catena primaria alla configurazione di **Hermes Agent**. È l'unico modulo che scrive fuori dal repo e che lancia un processo esterno.

> [!danger] Effetti collaterali all'avvio
> `engine.start()` parte con il server (`app._startup`). Con le impostazioni di default (catena `main` primaria, `auto_apply: true`, `gateway_restart: true`) il primo ciclo può **riscrivere `~/.hermes/config.yaml`** e lanciare `hermes gateway run --replace`. Vale anche per un uvicorn di prova in locale. Per provare senza effetti: metti `auto_apply: false` sulla primaria prima di avviare.

## Funzioni

| Funzione | Riga | Cosa fa |
|---|---|---|
| `read_config()` | 29 | Legge `~/.hermes/config.yaml`; `{}` se assente o YAML rotto |
| `current_active()` | 38 | `{model, order, config_path}` dalla config attuale |
| `apply_choice(model, provider, restart)` | 47 | Scrive la config, opzionalmente riavvia il gateway, logga `apply` |
| `evaluate_primary()` | 75 | Classifica, risolve la primaria, applica se diverso, salva telemetria |
| `_loop()` | 119 | Ciclo: `evaluate_primary`, poi attesa `interval_min` minuti (minimo 1) |
| `start()` / `stop()` | 129 / 138 | Avvia il thread (idempotente) / segnala lo stop |

## Cosa scrive `apply_choice`

```yaml
model:
  default: <modello>
  provider: openrouter
  base_url: https://openrouter.ai/api/v1
provider_routing:
  order: [<provider>]   # lista YAML vera: una stringa disattiva il pin in Hermes
```

Le altre chiavi della config vengono conservate, ma il file è riscritto con `yaml.safe_dump`: commenti e formattazione originali si perdono. La scrittura **non** è atomica (`write_text` diretto).

Riavvio: `time.sleep(1.5)` poi `subprocess.Popen(["hermes", "gateway", "run", "--replace"], start_new_session=True)`. Un errore diventa `gateway: "failed: …"` nel risultato, senza eccezione.

## `evaluate_primary` passo per passo

1. Nessuna primaria → `{"ok": False, "reason": "no primary chain"}`. Watchlist vuota → `"watchlist empty"`.
2. `ranking.rank_models` + `ranking.resolve_chain` sulla primaria.
3. Se c'è una risoluzione **e** `auto_apply` è vero:
   - diversa dall'attivo (modello o primo provider) → evento `switch` + `apply_choice`
   - uguale → `applied: "unchanged"`
   - in entrambi i casi `store.push_telemetry({ts, model, provider, blended})`
4. Ritorna `{ok, chain, resolution, active, auto_apply, applied?}`.

Le eccezioni nel ciclo vengono catturate e loggate come evento `engine_error`: il thread non muore mai.

## Chiamato da

- `app._startup` → `start()`
- `POST /api/evaluate` → `evaluate_primary()` (stessi effetti del ciclo: può scrivere la config)
- `POST /api/apply` → `apply_choice()` (scelta manuale dalla UI)
- `GET /api/state`, `GET /api/pipeline` → `current_active()`

## Note

- `_last_state` e `last_state()` (righe 26, 142) non vengono mai aggiornati né chiamati. `stop()` non è chiamato da nessuno.
- La telemetria viene salvata solo con `auto_apply` attivo. Vedi [[Insidie note#Telemetria solo con auto_apply]].
- Se `~/.hermes/` non esiste, `write_text` solleva `FileNotFoundError`: dal ciclo diventa un `engine_error`, da `/api/apply` un 500.

Collegate: [[ranking]], [[store]], [[Deploy e configurazione]]
