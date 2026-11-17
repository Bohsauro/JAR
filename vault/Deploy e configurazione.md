---
title: Deploy e configurazione
tags:
  - pennyroute
  - deploy
---

# Deploy e configurazione

## Avvio manuale

```bash
pip install -r requirements.txt
cp .env.example .env        # inserire OPENROUTER_API_KEY
uvicorn pennyroute.app:app --host 0.0.0.0 --port 8490
```

Va lanciato **dalla radice del repo**: [[orclient]] cerca `.env` nella directory di lavoro corrente.

> [!danger]
> L'avvio fa partire l'[[engine]], che con i default può riscrivere `~/.hermes/config.yaml`. Per una prova locale innocua usa una porta diversa e imposta `auto_apply: false` sulla catena primaria (`data/chains.json` o pagina Chains) prima di avviare.

## `install.sh`

Installer a comando unico, pensato per Linux:

1. Controlla `python3` ≥ 3.10 e `git`.
2. Clona in `$PENNY_INSTALL_DIR` (default `~/pennyroute`) oppure fa `git pull --ff-only`.
3. Crea `.venv` e installa le dipendenze.
4. Se la chiave non è in ambiente, né in `~/.hermes/.env`, né in `.env`: la chiede e la salva in `.env` (`chmod 600`).
5. Se c'è `systemctl` **e** gira come root: scrive `/etc/systemd/system/pennyroute.service` (`Restart=always`, `EnvironmentFile=-<dir>/.env`, utente `$SUDO_USER`) e lo abilita. Altrimenti stampa il comando manuale.

Variabili: `PENNY_PORT` (default 8490), `PENNY_INSTALL_DIR`. A runtime: `PENNY_ADMIN_TOKEN`, `PENNY_RATE_LIMIT`, `PENNY_WEBHOOK_URL` (vedi [[notify]]).

## Dipendenze (`requirements.txt`)

```
fastapi>=0.110
uvicorn[standard]>=0.29
pydantic>=2.6
PyYAML>=6.0
httpx>=0.27
```

Solo limiti inferiori, nessun lock file. `httpx` serve al proxy; [[orclient]] usa `urllib`.

## Chiave OpenRouter

Ordine (`orclient._key_lookup`): `data/openrouter_key` (salvata da Settings, vince) → `OPENROUTER_API_KEY` in ambiente → `.env` nella cwd → `~/.hermes/.env`. Senza chiave il server parte con un warning e le chiamate falliscono a runtime.

Da GUI (2026-11-17): Settings → OpenRouter key. `PUT /api/openrouter-key` valida il formato, prova la chiave con `GET https://openrouter.ai/api/v1/key` e la salva solo se OpenRouter risponde 200 (scrittura atomica, permessi 600). `GET` restituisce solo `{configured, source}`, mai la chiave. Evento `openrouter_key_set`. Test: `OpenRouterKeyFromDashboard`.

## Integrazione Hermes Agent

PennyRoute nasce come compagno di Hermes Agent. L'[[engine]] scrive in `~/.hermes/config.yaml` le chiavi `model.default`, `model.provider`, `model.base_url` e `provider_routing.order`, poi lancia `hermes gateway run --replace` se `gateway_restart` è attivo.

Chi usa PennyRoute solo come endpoint `/v1` non ha bisogno di Hermes: basta `auto_apply: false` sulla primaria.

## Versione

Il numero di versione è scritto in tre posti da tenere allineati:

- `pennyroute/__init__.py` → `__version__`
- `pennyroute/app.py:23` → `FastAPI(version=...)`
- messaggi di commit / README

## Rete e sicurezza

- Bind `0.0.0.0`: pensato per LAN o Tailscale.
- UI e `/api/*` senza autenticazione, CORS aperto. Il README raccomanda un reverse proxy se esposto. Vedi [[Insidie note#API di gestione senza autenticazione]].

## Repository

- Remote: `github.com/Bohsauro/JAR`, branch `main`, 13 commit.
- `docs/` è la landing per GitHub Pages più le spec storiche `V2-SPEC.md` e `V2-FRONTEND-SPEC.md`.
- `assets/` contiene banner e screenshot del README.
- `.ade/`, `.agents/`, `.gemini/` sono cartelle di strumenti locali, non fanno parte dell'applicazione.
- `tests/` contiene i test di regressione (`python -m unittest discover tests`). Nessuna CI, nessun Dockerfile (Docker è nella roadmap del README).

Collegate: [[engine]], [[orclient]], [[File dati]]
