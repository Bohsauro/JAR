---
title: Insidie note
tags:
  - pennyroute
  - insidie
  - debito
---

# Insidie note

Cose trovate leggendo il codice al commit `d2900a6`. Le voci sotto [[#Corretti]] sono state sistemate dopo; tutte le altre sono ancora aperte.

Legenda: **verificato** = riprodotto eseguendo il codice reale; **da lettura** = dedotto dal sorgente, non eseguito.

## Bug

### `/api/pipeline` fragile sulle righe di errore

**Da lettura.** In `api_pipeline` (`pennyroute/app.py:504`) il filtro legge `r["provider"]` **prima** di controllare se la riga è un errore. Una riga `{"error": ...}` da `rank_endpoints` solleva `KeyError` → 500. Capita solo se la cache degli endpoint scade tra `build_candidates` e il ciclo e OpenRouter fallisce in quel momento: raro, ma l'Overview interroga questa rotta ogni 5 secondi.

## Sicurezza

### API di gestione senza autenticazione

**Da lettura.** Solo `/v1/*` controlla la chiave. Tutto `/api/*` è aperto, e CORS è `allow_origins=["*"]` (`pennyroute/app.py:24`). Chiunque raggiunga la porta può:

- creare chiavi API (`POST /api/keys`) e quindi spendere credito OpenRouter
- riscrivere `~/.hermes/config.yaml` (`POST /api/apply`, `POST /api/evaluate`)
- cancellare catene, watchlist, provider

Con CORS aperto basta anche una pagina web qualsiasi aperta nel browser di una macchina in LAN. È una scelta dichiarata nel README ("LAN tool"), ma va tenuta presente prima di esporre il servizio.

### Scrittura di keys.json a ogni richiesta

**Da lettura.** `keys.verify_key` (`pennyroute/keys.py:60`) legge sotto lock, rilascia, poi riscrive tutto il file per aggiornare `last_used`. Una `revoke_key` che cade tra lettura e scrittura viene annullata: la chiave revocata torna nel file. Inoltre è una scrittura su disco per ogni chiamata `/v1`.

### Altro

- Confronto hash con `==` invece di `hmac.compare_digest` (`keys.py:70`).
- Nessun rate limit su nessuna rotta.
- `PUT /api/settings` accetta qualsiasi `mix` (anche chiavi mancanti o valori non numerici), che poi rompe il ranking a runtime.

## Effetti collaterali

### L'engine scrive fuori dal repo

Avviare il server fa partire il thread che può riscrivere `~/.hermes/config.yaml` e lanciare `hermes gateway run --replace`. Vale per qualsiasi avvio, anche di prova. Dettagli e come evitarlo in [[engine]].

La scrittura della config non è atomica e perde i commenti YAML.

### Il preset free svuota la watchlist

`PRESETS` contiene `free` con `models: []` (`pennyroute/store.py:92`). `POST /api/presets/free` salva una watchlist vuota. Da lì l'engine risponde `watchlist empty` e ogni step `cheapest` non trova nulla.

### Telemetria solo con auto_apply

`push_telemetry` è dentro il ramo `if res and primary.get("auto_apply", True)` (`pennyroute/engine.py:95`). Con `auto_apply: false` il grafico delle 24 ore nell'Overview resta vuoto. La docstring di `push_telemetry` elenca anche `tps`, `latency`, `uptime`, ma l'engine salva solo `ts, model, provider, blended`.

## Debito strutturale

### Logica di catena duplicata

`ranking.resolve_chain` (`ranking.py:90`) e `router_proxy.build_candidates` (`router_proxy.py:29`) implementano le stesse regole degli step. Differenze attuali da conoscere:

| Caso | `resolve_chain` (engine) | `build_candidates` (proxy) |
|---|---|---|
| `model` senza `providers`, miglior endpoint con provider esaurito | step saltato | prova gli altri endpoint sani |
| `cheapest`, modello col `best` su provider esaurito | passa al modello successivo | passa al modello successivo |

Quindi engine e proxy possono scegliere cose diverse per la stessa catena. Un nuovo tipo di step va aggiunto in tutti e due, più `app._validate_chain`, più l'editor in `static/app.js`.

### Chiamate bloccanti nell'event loop

`v1_chat` è `async` ma `build_candidates` chiama `rank_models` (thread pool + `urllib` bloccante, fino a 40 s per richiesta a cache fredda) e `record_usage` → `_estimate_spend` può fare un'altra chiamata bloccante. Durante quel tempo l'event loop è fermo e tutte le altre richieste `async` aspettano.

### Race leggi-modifica-scrivi

`store.add_model`, `remove_model` e tutte le rotte catene fanno load → modifica → save senza tenere il lock per l'intera sequenza. Due richieste concorrenti possono perdere un aggiornamento.

### Default mutabili condivisi

`store.load_models` ritorna direttamente la lista `DEFAULT_MODELS` quando il file manca; `add_model` ci fa `append` sopra. Innocuo finché si salva subito dopo, ma il default in memoria risulta modificato.

### Errori messi in cache

[[orclient]] mette in cache anche i fallimenti: un errore di rete su un modello lo rende "senza endpoint" per 10 minuti, il catalogo per un'ora. Si esce prima solo con `force=true`.

### Errore upstream mascherato

Nel proxy ogni status ≥ 400 fa passare al candidato successivo. Una richiesta malformata (400) viene ritentata su tutti i candidati e torna come 502 generico; il messaggio d'errore originale di OpenRouter si perde.

### File cresciuti

- `static/app.js`: 1442 righe in un file solo, tutte le viste insieme.
- `pennyroute/app.py`: 548 righe, con il blocco "settings → gates → rank → primary" ripetuto.
- `data/events.jsonl` cresce senza limite.

## Frontend

### Polling dell'Overview mai fermato

`_ovTimer` (`static/app.js:281`) viene azzerato solo quando si rientra nell'Overview. Uscendo dalla pagina continua a chiamare `/api/telemetry` e `/api/pipeline` ogni 5 secondi, e `/api/pipeline` ricalcola ranking e candidati a ogni chiamata.

### Font dichiarato e font caricato non coincidono

Risolto il 2026-11-16 (redesign JAR): `index.html` e la landing caricano Bricolage Grotesque e IBM Plex Mono, gli stessi dichiarati nel CSS.

### Landing in doppia copia

`static/landing.html` e `docs/index.html` vanno modificate insieme. Vedi [[Frontend SPA#Design system (`style.css`)]]. `docs/index.html` si rigenera dalla landing con logo relativo e link alla dashboard sostituiti da GitHub.

### Altro

- `/api/catalog` ritorna `{error}` con status 200 quando OpenRouter fallisce: la SPA deve controllare la forma, non lo status.
- La chiave API della chat resta in `localStorage` in chiaro.

## Codice morto

| Simbolo | File |
|---|---|
| `load_presets` | `store.py:101` |
| `search_catalog` | `orclient.py:190` |
| `has_any_key` | `keys.py:78` |
| `_last_state`, `last_state`, `stop` | `engine.py:26, 142, 138` |
| parametro `stream_ok` | `providers.py:207` |
| `refreshAll` | `static/app.js:77` |
| import `re`, `time` | `router_proxy.py` |
| import `json`, `os` | `keys.py` |

## Mancanze

- Test quasi assenti: solo `tests/test_regressions.py` (3 test). `resolve_chain` accetta già `provider_ok` iniettabile ed è il punto più facile da cui continuare.
- Nessun linter, formatter o type checker configurato.
- Nessun controllo all'avvio sulla presenza della chiave OpenRouter.

## Corretti

Sistemati il 2026-11-15, coperti da `tests/test_regressions.py`.

### Limite giornaliero che non si sblocca

`is_available` e `limits_status` leggevano la finestra salvata in `usage.json` senza controllare se era scaduta. La rotazione avveniva solo in `record_usage`, cioè solo quando il provider serviva una richiesta; ma un provider esaurito non veniva più scelto, quindi restava "exhausted" per sempre, fino a un Reset manuale.

Correzione: `providers.load_usage` applica `_rotated` in lettura a ogni finestra. Vale per tutti i lettori: gate del router, gauge e tabella usage della pagina Providers. Il file su disco viene riscritto alla prima richiesta registrata.

### Stream non byte-puro

`_wrap_stream` decodificava ogni chunk in UTF-8 con `errors="ignore"` e lo ricodificava. Un carattere multibyte a cavallo di due chunk spariva (`b'perch\xc3'` + `b'\xa9'` → `b'perch'`).

Correzione: i chunk passano intatti; la coda di 64 KB è tenuta in byte e decodificata una volta sola a fine stream per estrarre `usage`.

Collegate: [[Dove modificare]], [[Convenzioni e vincoli]], [[Architettura]]

## Corretti il 2026-11-16

Coperti da `tests/test_regressions.py` (`ApiRegressions`) salvo dove indicato. Le voci corrispondenti sopra sono superate.

- `/api/pipeline`: le righe `{"error"}` vengono scartate prima di leggere `provider` (niente più `KeyError`/500).
- `keys.verify_key`: lettura e scrittura sotto un solo lock (una revoca concorrente non viene annullata); confronto con `hmac.compare_digest`; tolti gli import morti.
- Preset `free` (vuoto): `POST /api/presets/{name}` risponde 400 se il preset non ha modelli.
- `store.load_models` restituisce una copia dei default.
- Polling Overview: si ferma da solo quando `#ov-side` non è più nel DOM (non testato).

Restano aperti: `/api/*` senza auth, race nello store, event loop bloccato, logica di catena duplicata, errori 400 mascherati.

### Secondo giro, 2026-11-16

Test in `MoreRegressions`. Corretti anche:

- Race leggi-modifica-scrivi: `store._lock` è ora `RLock`, esposto come `store.lock`; `add_model`, `remove_model` e tutte le rotte catene/settings lo tengono per tutta la sequenza.
- `PUT /api/settings`: `mix` validato (chiavi `in/cache/out` numeriche ≥ 0, non tutte zero), soglie ≥ 0, `interval_min` ≥ 1.
- Proxy: `build_candidates`, `is_available`, `record_usage` girano in `asyncio.to_thread` (event loop libero). Gli errori upstream ≥ 400 includono il messaggio originale (300 caratteri) nel 502 finale.
- `resolve_chain` (step `model` senza `providers`) passa al prossimo endpoint sano come il proxy.
- `orclient`: gli errori restano in cache 30 s (`ERROR_TTL`), non 10 min / 1 h.
- Telemetria registrata anche con `auto_apply: false`.
- `events.jsonl` tagliato a 2000 righe oltre 1 MB.
- Font: la dashboard carica Hanken Grotesk e Geist Mono, come dichiarato nel CSS (non verificato a vista).
- Codice morto rimosso (`load_presets`, `search_catalog`, `has_any_key`, `engine.stop/last_state`, `stream_ok`, `refreshAll`, import inutili).

Restano: `/api/*` senza auth e CORS aperto (scelta di design), `/api/pipeline` che ricalcola il ranking a ogni chiamata, `app.js` da 1400 righe, chiave chat in `localStorage`, nessun rate limit.

### Terzo giro, 2026-11-16: hosting

Tutti in `HostingGuards`. Nuovo modulo `pennyroute/security.py`.

- `/api/*` richiede `PENNY_ADMIN_TOKEN` (header `X-Admin-Token` o `Authorization: Bearer`, confronto a tempo costante). Senza token risponde solo a loopback e **mai** se c'è `X-Forwarded-For` (un proxy locale non apre il servizio). 10 token errati/minuto per IP, poi 429.
- `/v1/*`: rate limit per IP, `PENNY_RATE_LIMIT` (default 120/min, 0 = off).
- CORS aperto (`*`) solo con token impostato; senza, nessuna origine esterna.
- `GET /healthz` pubblico. Avvio: avvisa se mancano chiave OpenRouter o token.
- La dashboard chiede il token una volta (`localStorage.penny_admin`).
- L'engine applica a Hermes solo se `~/.hermes` esiste; `/api/apply` risponde 409 altrimenti.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`; `install.sh` genera il token. Contatori del rate limit in memoria: un solo worker.
- Il superato: "API di gestione senza autenticazione" e "Nessun rate limit" nelle sezioni sopra.
