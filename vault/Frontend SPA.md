---
title: Frontend SPA
tags:
  - pennyroute
  - frontend
---

# Frontend SPA

Vanilla JS, nessun framework, nessun build, nessun `npm`. Tre file:

| File | Righe | Ruolo |
|---|---|---|
| `static/index.html` | 33 | Guscio: barra in alto con wordmark JAR, `#nav` (link `<a href="#/vista">`), `#routing-now`; poi `#view`, `#toasts` |
| `static/app.js` | 1442 | Tutta la logica: router, stato, viste, chiamate API |
| `static/style.css` | 482 | Design system |

In più `static/landing.html` (pagina marketing servita su `/landing`) e la sua copia per GitHub Pages `docs/index.html`.

## Struttura di `app.js`

| Righe | Blocco |
|---|---|
| 3–14 | Helper: `$`, `$$`, `fmt`, `esc` (escape HTML) |
| 16–22 | Stato globale |
| 24–40 | `api(path, opts)`, `toast(msg, isErr)` |
| 42–73 | `ICONS`, `NAV`, `buildNav()` |
| 84–117 | Grafici SVG a mano: `sparkPath`, `donutSegs`, `svgSparkline`, `PALETTE` |
| 119–295 | **Overview**: `viewOverview`, `loadOverview` |
| 297–395 | **Ranking**: `mixControls`, `viewRanking`, `renderRankRows`, `loadDetail`, `applyChoice` |
| 397–561 | **Catalog**: `viewCatalog`, `loadCatalog`, `renderCatalogControls`, `renderCatalogTable`, `addAllFiltered` |
| 563–801 | **Providers**: gauge, `viewProviders`, `loadProviders`, `renderProvidersTable`, `openEditModal`, `ovProviderRows` |
| 803–1081 | **Chains**: `viewChains`, `renderChains`, `chainEntryRow`, `fillProviders`, `saveChain`, `chainAction` |
| 1083–1174 | **API endpoint**: `viewApi` (chiavi, esempi d'uso) |
| 1176–1285 | **Chat**: `viewChat` |
| 1289–1364 | **Watchlist**: `viewModels` (preset, ricerca con autocomplete) |
| 1366–1410 | **Settings**, **Events** |
| 1415–1442 | Router: `VIEWS`, `route()`, `loadCommon()`, avvio |

## Routing

Hash routing: `#/overview`, `#/ranking`, `#/catalog`, `#/chains`, `#/providers`, `#/api`, `#/chat`, `#/models`, `#/settings`, `#/events`. `route()` cerca il nome in `VIEWS` (default `overview`) e chiama la funzione vista, che **riscrive `#view` con `innerHTML`** e poi attacca gli handler.

Aggiungere una pagina = funzione `viewX` + voce in `VIEWS` + voce in `NAV` + icona in `ICONS`.

## Stato globale

```js
STATE      // /api/state — riletto ogni 30 s
RANKED     // /api/rank
CHAINS     // /api/chains
MODELS     // /api/models
PROVIDERS  // /api/providers
CHAIN_AVAIL// mappa disponibilità provider per l'editor catene
CAT        // filtri e pagina del catalogo
```

`loadCommon()` all'avvio carica `STATE`, `CHAINS`, `MODELS` in parallelo, poi `RANKED`, poi fa `route()`. Dopo ogni modifica le viste ricaricano a mano la variabile toccata (`CHAINS = (await api("/api/chains")).chains`). Non c'è reattività: chi cambia lo stato deve richiamare il render.

## Chiamate API

Tutto passa da `api()`, che lancia `Error(detail)` su status non OK. Eccezione: la pagina Chat usa `fetch` diretto verso `/v1/models` e `/v1/chat/completions` con header `X-API-Key`.

La chat **non usa lo streaming** (`max_tokens: 2048`, attende il JSON) e mostra `pennyroute.served_by`. La chiave è in `localStorage["penny_key"]`.

## Timer

| Dove | Intervallo | Cosa |
|---|---|---|
| avvio (riga 1439) | 30 s | rilegge `/api/state` |
| `loadOverview` (riga 281) | 5 s | `/api/telemetry` + `/api/pipeline` |

Il timer dell'Overview non viene fermato quando si cambia pagina. Vedi [[Insidie note#Polling dell'Overview mai fermato]].

## Design system (`style.css`)

Rifatto il 2026-11-16 col rebrand **JAR — Just Another Router**. Direzione chiara "banco da laboratorio": carta grigio-blu, superfici bianche, inchiostro. Il cobalto segna ciò che è cliccabile, l'ottone (il coperchio del barattolo) è riservato ai soldi (`.pnum`, valore blended), verde/ambra/rosso solo per lo stato di salute.

```css
--paper: #eceef1;  --surface: #fff;  --ink: #16191e;  --line: #d6dae0;
--cobalt: #2b45e0;  --brass: #a87a12;  --ok: #0e7a55;  --warn: #a96300;  --bad: #c0352c;
--sans: "Bricolage Grotesque";  --mono: "IBM Plex Mono";   /* caricati da index.html */
```

I vecchi nomi (`--green`, `--amber`, `--blue`, `--red`, `--faint`, `--accent`, `--surface2`, `--bg2`, `--border2`…) restano come **alias** in fondo a `:root`, perché `app.js` li usa negli stili inline. Non rimuoverli senza ripulire `app.js`.

Componenti da riusare: `.panel`, `.badge` (`ok/warn/bad/neut/info`, `tier-*`), `.pill`, `.prov .dot`, `.pulse`, `.metric`, `.row-ctl`, `.field`, `.switch`, bottoni (`primary/ghost/danger/sm`), `.chain-node` / `.chain-flow`, `.ac-list`, `.chip`, `.gauge`, `.facet`, `.modal`, `.bar-row`.

`renderRoutingNow()` in `app.js` riempie `#routing-now` (modello @ provider + $/M) a ogni `loadCommon()` e al polling di 30 s.

La landing (`static/landing.html`, servita su `/landing`) ha CSS inline con gli stessi token. `docs/index.html` è la sua copia per GitHub Pages: logo relativo e link "dashboard" verso GitHub. Va rigenerata quando cambia la landing.

> [!note] Rebrand solo di facciata
> Il nome JAR riguarda UI, landing e README. Restano invariati: pacchetto `pennyroute/`, variabili `PENNY_*`, alias modello `penny` / `penny:<catena>`, chiavi `pnk-`, campo di risposta `pennyroute.served_by`, chiavi `localStorage` `penny_*`.

## Sicurezza del rendering

Le viste costruiscono HTML con template string. Ogni valore dinamico va passato per `esc()`. La chat usa `textContent` per i messaggi.

## Landing

`static/landing.html` e `docs/index.html` sono la stessa pagina mantenuta in **due copie**. Differiscono solo per i percorsi (`/logo.svg` contro `logo.svg`) e per il bottone "Open dashboard" (`/#/overview` contro il link GitHub). Una modifica al testo va fatta in entrambe.

Collegate: [[API HTTP]], [[Convenzioni e vincoli]], [[Dove modificare]]
