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
| `static/index.html` | 35 | Guscio: sidebar con `#nav`, `#view`, `#toasts` |
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

"High-End Developer Tool": tela ultra-scura, accento verde, numeri in mono, pannelli traslucidi con bordi sottili. Token in `:root` (righe 6–33):

```css
--bg: #09090b;  --green: #3ecf8e;  --amber: #ffbc33;  --red: #ff6363;  --blue: #55b3ff;
--panel: rgba(255,255,255,.02);  --border: rgba(255,255,255,.06);
--radius: 8px;  --radius-lg: 12px;
--sans: "Hanken Grotesk", ...;  --mono: "Hanken Grotesk Mono", ...;
```

Componenti esistenti da riusare: `.panel`, `.badge` (`ok/warn/bad/neut/info`), `.pill`, `.prov .dot`, `.pulse`, `.metric`, `.row-ctl`, `.field`, `.switch`, varianti `.btn`, `.chain-node` / `.chain-flow` / `.chain-arrow`, `.ac-list` (autocomplete), `.chip` / `.chips`, `.gauge`, `.facet`, `.modal`, `.bar-row`, badge dei tier.

Sezioni del CSS: sidebar (64), main (99), metriche (112), pannelli (127), bottoni (151), tabelle (185), input (235), overview v2 a griglia 12 colonne (259), pipeline catene (345), eventi (365), toast (370), autocomplete (385), componenti v2 (401), catalogo (450).

> [!warning] Font
> `index.html` carica **Geist** e **Geist Mono** da Google Fonts, ma il CSS chiede `"Hanken Grotesk"`. Vedi [[Insidie note#Font dichiarato e font caricato non coincidono]].

## Sicurezza del rendering

Le viste costruiscono HTML con template string. Ogni valore dinamico va passato per `esc()`. La chat usa `textContent` per i messaggi.

## Landing

`static/landing.html` e `docs/index.html` sono la stessa pagina mantenuta in **due copie**. Differiscono solo per i percorsi (`/logo.svg` contro `logo.svg`) e per il bottone "Open dashboard" (`/#/overview` contro il link GitHub). Una modifica al testo va fatta in entrambe.

Collegate: [[API HTTP]], [[Convenzioni e vincoli]], [[Dove modificare]]
