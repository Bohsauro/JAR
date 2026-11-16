/* JAR (Just Another Router) — SPA logic (vanilla JS, no build step) */

const $ = (q, el) => (el || document).querySelector(q);
const $$ = (q, el) => Array.from((el || document).querySelectorAll(q));

const fmt = (v, d = 4) =>
  v === null || v === undefined ? "n/a" : (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(d));

const esc = s => (s || "").replace(/[&<>"']/g, c =>
  c === "&" ? "&" + "amp;"
    : c === "<" ? "&" + "lt;"
    : c === ">" ? "&" + "gt;"
    : c === '"' ? "&" + "quot;"
    : "&" + "#39;");

let STATE = { active: {}, settings: {}, primary_chain: null };
let RANKED = [];
let CHAINS = [];
let MODELS = [];
let PROVIDERS = [];
let CHAIN_AVAIL = {};
const CAT = { q: "", tier: "", family: "", tag: "", sort: "", limit: 50, offset: 0, total: 0, results: [], facets: null };

let _adminPromptDone = false;
async function api(path, opts = {}) {
  const tok = localStorage.getItem("penny_admin");
  const o = tok ? { ...opts, headers: { ...(opts.headers || {}), "X-Admin-Token": tok } } : opts;
  const r = await fetch(path, o);
  if (r.status === 401 && !_adminPromptDone) {
    const t = prompt("Admin token (PENNY_ADMIN_TOKEN on the server):");
    if (!t) _adminPromptDone = true;  // cancelled: don't re-prompt on every poll
    else { localStorage.setItem("penny_admin", t.trim()); return api(path, opts); }
  }
  if (!r.ok) {
    let msg = r.status;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  return r.json();
}

function toast(msg, isErr) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13h8V3H3zM13 21h8V11h-8zM13 7h8V3h-8zM3 21h8v-4H3z"/></svg>',
  ranking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  chains: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  api: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  models: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l2.5 2.5"/></svg>',
  catalog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  providers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 8h.01M6 18h.01"/></svg>',
};

const NAV = [
  ["overview", "Overview", ICONS.overview],
  ["ranking", "Ranking", ICONS.ranking],
  ["catalog", "Catalog", ICONS.catalog],
  ["chains", "Fallback chains", ICONS.chains],
  ["providers", "Providers", ICONS.providers],
  ["api", "API endpoint", ICONS.api],
  ["chat", "Chat", ICONS.chat],
  ["models", "Watchlist", ICONS.models],
  ["settings", "Settings", ICONS.settings],
  ["events", "Events", ICONS.events],
];

function buildNav() {
  $("#nav").innerHTML = NAV.map(([id, label, icon]) =>
    `<a class="nav-item" href="#/${id}" data-view="${id}">${icon}<span>${label}</span></a>`).join("");
}

/* top-bar readout: what requests are routed to right now */
function renderRoutingNow() {
  const a = STATE.active || {};
  const prov = (a.order && a.order[0]) || "auto";
  const best = RANKED.find(m => m.slug === a.model);
  const price = best && best.best ? fmt(best.best.blended) + " $/M" : "";
  $("#routing-now").innerHTML = a.model
    ? `<span class="pulse"></span><span class="what">${esc(a.model)} @ ${esc(prov)}</span><span class="price">${price}</span>`
    : `<span class="dot"></span><span class="what">no active route</span>`;
}

/* ------------------------------------------------------------------ data */

/* ---------------------------------------------------------------- views */

/* sparkline helper: area path from values */
function sparkPath(vals, w = 200, h = 34) {
  if (!vals.length) return "";
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const x = i => (i / (vals.length - 1)) * w;
  const y = v => h - 2 - ((v - min) / span) * (h - 6);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  return { line: "M" + pts.join(" L"), area: "M0," + h + " L" + pts.join(" L") + " L" + w + "," + h + " Z", max, min };
}

/* donut helper: stroke-dasharray segments */
function donutSegs(parts, r = 34, c = 2 * Math.PI * r) {
  const total = parts.reduce((a, b) => a + b[1], 0) || 1;
  let acc = 0;
  return parts.map(([label, v, color]) => {
    const frac = v / total;
    const seg = { label, v, color, frac,
      dash: `${(frac * c).toFixed(1)} ${(c * (1 - frac)).toFixed(1)}`,
      offset: (-acc * c).toFixed(1) };
    acc += frac;
    return seg;
  });
}

function svgSparkline(vals, color = "var(--green)") {
  if (!vals || vals.length < 2) return "";
  const { line, area } = sparkPath(vals);
  return `<svg class="spark-svg" viewBox="0 0 200 34" preserveAspectRatio="none">
    <path d="${area}" fill="${color}" opacity="0.12"></path>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.4"></path>
  </svg>`;
}

const PALETTE = ["var(--green)", "var(--blue)", "var(--amber)", "var(--red)", "#5b3fb3"];

function viewOverview() {
  const a = STATE.active;
  const order = (a.order && a.order.length) ? a.order.join(", ") : "auto";
  const primary = CHAINS.find(c => c.name === STATE.primary_chain);
  const tpsFirst = RANKED[0]?.best;
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Overview</h1><div class="sub">What is running right now, and what will run if this one fails.</div></div>
      <button class="primary" id="btn-evaluate">Evaluate now</button>
    </div>
    <div class="ov-grid">
      <div class="ov-main">
        <div id="ov-metrics" class="ov-metrics"><span class="spinner"></span></div>
        <div class="panel"><h2><span class="k">Fallback pipeline</span></h2><div id="ov-pipe"><span class="spinner"></span></div></div>
        <div class="panel"><h2><span class="k">Top 5 cheapest</span> — blended, your mix</h2><div id="ov-table"><span class="spinner"></span></div></div>
      </div>
      <div class="ov-side" id="ov-side"><span class="spinner"></span></div>
    </div>`;
  $("#btn-evaluate").onclick = async () => {
    toast("Evaluating chain…");
    try { const r = await api("/api/evaluate", { method: "POST" });
      toast(r.ok ? `OK: ${r.resolution ? r.resolution.model + " @ " + r.resolution.provider : "no healthy step"}` : "Failed: " + r.reason, !r.ok);
      await loadOverview();
    } catch (e) { toast(e.message, true); }
  };
  loadOverview();
  $("#ov-side").style.display = "grid";
}

let _ovTimer = null;

async function loadOverview() {
  const [tml, pipe, ev, prov] = await Promise.all([
    api("/api/telemetry").catch(() => ({ points: [], avg_latency: 0 })),
    api("/api/pipeline").catch(() => ({ candidates: [] })),
    api("/api/events?limit=6").catch(() => ({ events: [] })),
    api("/api/providers").catch(() => ({ providers: [] })),
  ]);
  // average latency across candidates (ms)
  const lats = (pipe.candidates || []).map(c => c.latency).filter(v => v != null);
  tml.avg_latency = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
  const a = STATE.active;

  // metric row + pipeline + table + side panel
  const blendedSeries = (tml.points || []).map(p => p.blended).filter(v => v != null);
  const last = blendedSeries.length ? blendedSeries[blendedSeries.length - 1] : null;
  const first = blendedSeries.length ? blendedSeries[0] : null;
  const delta = (last != null && first != null && first > 0) ? ((last - first) / first * 100) : null;
  const dTxt = delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% 24h` : "collecting";
  const avgLat = Math.round(tml.avg_latency || 0);

  $("#ov-metrics").innerHTML = `
    <div class="metrics" style="position:relative">
      <div class="metric spark">
        ${svgSparkline(blendedSeries, "var(--green)")}
        <div class="label">Blended $/M</div>
        <div class="value">${last != null ? fmt(last) : "—"}</div>
        <div class="sub">${esc(a.model || "—")} @ ${esc((a.order && a.order[0]) || "auto")}</div>
        <div class="delta ${delta != null && delta > 0 ? "" : "down"}">${esc(dTxt)}</div>
      </div>
      <div class="metric">
        <div class="label">Latency p50</div>
        <div class="value">${avgLat ? avgLat + "ms" : "—"}</div>
        <div class="sub">avg across chain candidates</div>
      </div>
      <div class="metric">
        <div class="label">Watchlist</div>
        <div class="value">${MODELS.length}</div>
        <div class="sub">ranked every ${STATE.settings.interval_min} min</div>
      </div>
    </div>`;

  const cands = pipe.candidates || [];
  $("#ov-pipe").innerHTML = cands.length ? `<div class="flow">` + cands.map((c, i) => {
    const isActive = c.model === a.model && c.provider === (a.order && a.order[0]);
    const lvl = i === 0 ? "Live" : i === 1 ? "Failover" : i === 2 ? "Emergency" : "Fallback";
    return `<div class="fnode ${isActive ? "active" : "standby"}">
        <div class="lbl">${isActive ? "● " : ""}${lvl}</div>
        <div class="sub">${esc(c.provider)}</div>
        <div class="m2">${esc(c.model)}</div>
        <div class="stats"><span>${c.latency != null ? Math.round(c.latency) + "ms" : "?"}</span><span>${c.tps != null ? c.tps.toFixed(0) + " tps" : "?"}</span><span>${c.uptime != null ? c.uptime.toFixed(1) + "%" : "?"}</span></div>
      </div>` + (i < cands.length - 1 ? `<div class="farrow"><span class="dash">➔</span></div>` : "");
  }).join("") + `</div>` : '<div class="empty">no candidates — configure a chain</div>';

  const maxBl = Math.max(...RANKED.map(m => m.best ? m.best.blended : 0).filter(Boolean), 0.000001);
  $("#ov-table").innerHTML = `<table><thead><tr>
      <th class="num">#</th><th>Model</th><th>Provider</th><th class="num">Health</th><th class="num">tps</th><th class="num">Blended $/M</th><th class="num">pct of max</th><th></th>
    </tr></thead><tbody>` + RANKED.slice(0, 5).map((m, i) => {
      const b = m.best; if (!b) return "";
      const pct = b.blended > 0 ? ((b.blended / maxBl) * 100).toFixed(0) : "0";
      return `<tr class="${m.slug === a.model ? "active-row" : ""}">
        <td class="num faint"><span class="badge neut">#${i + 1}</span></td>
        <td><span class="model-name">${esc(m.slug)}</span></td>
        <td><span class="prov"><span class="dot ${b.healthy ? "ok" : "bad"}"></span>${esc(b.provider)}</span></td>
        <td class="num"><span style="display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px"><span class="pulse" style="width:6px;height:6px"></span>${b.uptime != null ? b.uptime.toFixed(1) + "%" : "—"}</span></td>
        <td class="num"><span class="tps">${b.tps ? b.tps.toFixed(0) : "n/a"}<span class="tbar"><span style="width:${Math.min(100, Math.round((b.tps || 0) / 200 * 100))}%;background:linear-gradient(90deg,var(--green-soft),var(--blue))"></span></span></span></td>
        <td class="num"><span class="pnum">${fmt(b.blended)}</span></td>
        <td class="num"><span class="badge ${pct <= 30 ? "ok" : pct <= 70 ? "warn" : "bad"}">${pct}%</span></td>
        <td><button class="sm ghost" data-m="${esc(m.slug)}" data-p="${esc(b.provider)}">Route now</button></td>
      </tr>`;
    }).join("") + `</tbody></table>`;
  $$("#ov-table button[data-m]").forEach(btn => btn.onclick = () => applyChoice(btn.dataset.m, btn.dataset.p));

  // side panel
  const b = RANKED[0] ? RANKED[0].best : null;
  const donut = b ? donutSegs([
    ["in", b.in, "var(--blue)"],
    ["cache", b.cache, "var(--green)"],
    ["out", b.out, "var(--amber)"],
  ]) : [];
  const maxC = Math.max(...cands.map(c => c.blended || 0).filter(Boolean), 0.0001);
  const ovProvs = ovProviderRows(prov.providers || []);
  $("#ov-side").innerHTML = `
    <div class="panel">
      <span class="live-pill"><span class="pulse"></span><span>Routing engine running</span><span class="u">· 5m</span></span>
      <div style="margin-top:12px" class="hint"><span style="font-family:var(--mono)">${esc(a.model || "—")}</span> @ <span style="font-family:var(--mono)">${esc((a.order && a.order[0]) || "—")}</span></div>
    </div>
    <div class="panel"><h2><span class="k">Blended cost</span> — 24h trend</h2>
      <div class="trend-box">
        ${svgSparkline(blendedSeries.length > 1 ? blendedSeries : [0, 0, 0, last || 0, last || 0], "var(--green)")}
        <div class="trend-meta">
          <span class="trend-now">${last != null ? fmt(last) : "—"} $/M now</span>
          <span class="trend-samples">${tml.points.length} samples</span>
        </div>
      </div>
    </div>
    <div class="panel"><h2><span class="k">Cost composition</span> — active endpoint</h2>
      ${b ? `<div class="donut-wrap">
        <svg width="86" height="86" viewBox="0 0 86 86">
          <circle cx="43" cy="43" r="34" fill="none" stroke="var(--line)" stroke-width="11"></circle>
          ${donut.map(s => `<circle cx="43" cy="43" r="34" fill="none" stroke="${s.color}" stroke-width="11" stroke-dasharray="${s.dash}" stroke-dashoffset="${s.offset}" transform="rotate(-90 43 43)"></circle>`).join("")}
          <text x="43" y="39" text-anchor="middle" fill="var(--text)" font-size="13" font-family="var(--mono)" font-weight="600">${fmt(b.blended)}</text>
          <text x="43" y="54" text-anchor="middle" fill="var(--faint)" font-size="8" font-family="var(--mono)">$/M</text>
        </svg>
        <div class="share-list">${donut.map(s => `<div class="share-row"><span class="dot" style="background:${s.color}"></span><span class="nm">${s.label}</span><span class="bar"><span style="width:${(s.frac * 100).toFixed(0)}%;background:${s.color}"></span></span><span class="pc">${(s.frac * 100).toFixed(0)}%</span></div>`).join("")}</div>
      </div>` : '<div class="empty">no data</div>'}
    </div>
    <div class="panel"><h2><span class="k">Chain candidates</span> — cost ladder</h2>
      <div class="share-list">${cands.slice(0, 5).map((c, i) => `<div class="share-row">
        <span class="dot" style="background:${PALETTE[i % PALETTE.length]};flex:none"></span>
        <div class="growbar">
          <span class="nm" title="${esc(c.model)}">${esc(c.provider)}</span>
          <span class="bar"><span style="width:${((c.blended || 0) / maxC * 100).toFixed(0)}%;background:${PALETTE[i % PALETTE.length]}"></span></span>
        </div>
        <span class="pc">${c.blended != null ? fmt(c.blended) : "—"}</span>
        <button class="sm ghost route" data-r="${esc(c.model)}" data-rp="${esc(c.provider)}">Route</button>
      </div>`).join("") || '<div class="empty">no candidates</div>'}</div>
    </div>
    <div class="panel"><h2><span class="k">Provider usage</span> — day limits</h2>
      <div>${ovProvs}</div>
    </div>
    <div class="panel"><h2><span class="k">Recent events</span></h2>
      <div>${ev.events.length ? ev.events.slice(0, 5).map(e => `<div class="ev-row"><span class="ts">${esc(e.ts)}</span><span class="badge ${e.event === "switch" ? "ok" : e.event === "engine_error" ? "bad" : "neut"}">${esc(e.event)}</span></div>`).join("") : '<div class="empty">no events</div>'}</div>
    </div>`;

  // ladder route buttons
  $$("#ov-side button[data-r]").forEach(btn => btn.onclick = () => {
    applyChoice(btn.dataset.r, btn.dataset.rp);
  });

  // live refresher: ping every 5s (lightweight: just update pill + latency)
  clearInterval(_ovTimer);
  _ovTimer = setInterval(async () => {
    if (!document.getElementById("ov-side")) { clearInterval(_ovTimer); return; }
    try {
      const t2 = await api("/api/telemetry");
      const pts = t2.points || [];
      const lastP = pts.length ? pts[pts.length - 1] : null;
      const p2 = await api("/api/pipeline");
      const l2 = (p2.candidates || []).map(c => c.latency).filter(v => v != null);
      const la = l2.length ? Math.round(l2.reduce((a, b) => a + b, 0) / l2.length) : 0;
      const pill = document.querySelector("#ov-side .live-pill .u");
      const latE = document.querySelector("#ov-metrics .metric:nth-child(2) .value");
      if (pill) pill.textContent = "· " + (la ? la + "ms" : "—");
      if (latE) latE.textContent = la ? la + "ms" : "—";
    } catch (e) {}
  }, 5000);
}

function mixControls(id) {
  const m = STATE.settings.mix;
  return `<div class="row-ctl">
    <div><label class="field">Input %</label><input type="number" id="${id}-in" value="${Math.round(m.in * 100)}" min="0" max="100"></div>
    <div><label class="field">Cache %</label><input type="number" id="${id}-cache" value="${Math.round(m.cache * 100)}" min="0" max="100"></div>
    <div><label class="field">Output %</label><input type="number" id="${id}-out" value="${Math.round(m.out * 100)}" min="0" max="100"></div>
  </div>`;
}

function viewRanking() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Ranking</h1><div class="sub">Blended $/M per 1M total tokens under your real token mix. Health gate: tps ≥ ${STATE.settings.min_tps}, uptime ≥ ${STATE.settings.min_uptime}%.</div></div>
      <div><button class="ghost" id="btn-refresh">↻ Refresh</button></div>
    </div>
    <div class="panel"><h2><span class="k">Token mix</span></h2><div style="max-width:560px">${mixControls("mix")}</div></div>
    <div class="panel"><table><thead><tr>
      <th class="num">#</th><th>Model</th><th>Best provider</th><th class="num">in</th><th class="num">cache</th><th class="num">out</th><th class="num">Blended $/M</th><th class="num">tps</th><th class="num">uptime</th><th class="num">providers</th><th></th>
    </tr></thead><tbody id="rank-rows"></tbody></table></div>
    <div class="panel" id="detail-card" style="display:none"><h2><span class="k">Providers</span> — <span style="font-family:var(--mono)">${"<span id='detail-slug'></span>"}</span></h2>
      <table><thead><tr><th class="num">#</th><th>Provider</th><th class="num">in</th><th class="num">cache</th><th class="num">out</th><th class="num">Blended</th><th class="num">discount</th><th class="num">tps</th><th class="num">uptime</th><th></th><th></th></tr></thead>
      <tbody id="ep-rows"></tbody></table></div>`;
  renderRankRows();
  $("#btn-refresh").onclick = async () => {
    toast("Re-ranking (fresh fetch)…");
    RANKED = (await api("/api/rank?force=true")).models;
    renderRankRows();
  };
  ["in", "cache", "out"].forEach(k => $("#mix-" + k).oninput = async () => {
    const mi = +$("#mix-in").value / 100, mc = +$("#mix-cache").value / 100, mo = +$("#mix-out").value / 100;
    if (Math.abs(mi + mc + mo - 1) > 0.011) return;
    await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mix: { in: mi, cache: mc, out: mo } }) });
    STATE.settings.mix = { in: mi, cache: mc, out: mo };
    RANKED = (await api("/api/rank")).models;
    renderRankRows();
  });
}

function renderRankRows() {
  const cur = STATE.active.model;
  $("#rank-rows").innerHTML = RANKED.map((m, i) => {
    const b = m.best;
    if (m.error) return `<tr><td class="num">${i + 1}</td><td colspan="10" style="color:var(--red)">${esc(m.slug)}: ${esc(m.error)}</td></tr>`;
    if (!b) return `<tr><td class="num">${i + 1}</td><td><span class="model-name">${esc(m.slug)}</span></td><td colspan="9" class="faint">no endpoints</td></tr>`;
    const hc = m.healthy_count, pc = m.provider_count;
    const cls = hc === pc ? "ok" : hc > 0 ? "warn" : "bad";
    const barW = Math.min(100, Math.round((b.tps || 0) / 200 * 100));
    const barCls = b.tps >= 100 ? "ok" : b.tps >= 45 ? "warn" : "bad";
    const barColor = barCls === "ok" ? "var(--green-soft)" : barCls === "warn" ? "var(--amber)" : "var(--red)";
    return `<tr class="${m.slug === cur ? "active-row" : ""}">
      <td class="num faint">${i + 1}</td>
      <td><div class="model-name">${esc(m.slug)}</div><div class="model-sub">${esc(m.note || "")}</div></td>
      <td><span class="prov"><span class="dot ${b.healthy ? "ok" : "bad"}"></span>${esc(b.provider)}${b.cache_est ? ' <span class="mini">≈</span>' : ""}</span></td>
      <td class="num">${fmt(b.in)}</td><td class="num">${fmt(b.cache)}</td><td class="num">${fmt(b.out)}</td>
      <td class="num"><span class="pnum">${fmt(b.blended)}</span></td>
      <td class="num"><span class="tps">${b.tps ? b.tps.toFixed(0) : "n/a"}<span class="tbar"><span style="width:${barW}%;background:${barColor}"></span></span></span></td>
      <td class="num">${b.uptime ? b.uptime.toFixed(1) + "%" : "n/a"}</td>
      <td class="num"><span class="badge ${cls}">${hc}/${pc}</span></td>
      <td><button class="sm ghost" data-slug="${esc(m.slug)}">providers</button></td>
    </tr>`;
  }).join("");
  $$("#rank-rows button[data-slug]").forEach(b => b.onclick = () => loadDetail(b.dataset.slug));
}

async function loadDetail(slug) {
  $("#detail-card").style.display = "";
  $("#detail-slug").textContent = slug;
  $("#ep-rows").innerHTML = '<tr><td colspan="11"><span class="spinner"></span> loading…</td></tr>';
  try {
    const d = await api("/api/endpoints/" + encodeURIComponent(slug));
    $("#ep-rows").innerHTML = d.endpoints.map((e, i) => {
      if (e.error) return `<tr><td colspan="11" style="color:var(--red)">${esc(e.error)}</td></tr>`;
      const barW = Math.min(100, Math.round((e.tps || 0) / 200 * 100));
      const barCls = e.tps >= 100 ? "ok" : e.tps >= 45 ? "warn" : "bad";
      const barColor = barCls === "ok" ? "var(--green-soft)" : barCls === "warn" ? "var(--amber)" : "var(--red)";
      return `<tr>
        <td class="num faint">${i + 1}</td>
        <td><span class="prov"><span class="dot ${e.healthy ? "ok" : "bad"}"></span><b>${esc(e.provider)}</b></span></td>
        <td class="num">${fmt(e.in)}</td><td class="num">${fmt(e.cache)}${e.cache_est ? ' <span class="mini">≈</span>' : ""}</td>
        <td class="num">${fmt(e.out)}</td><td class="num"><span class="pnum">${fmt(e.blended)}</span></td>
        <td class="num">${e.discount ? (e.discount * 100).toFixed(0) + "%" : "—"}</td>
        <td class="num"><span class="tps">${e.tps ? e.tps.toFixed(0) : "n/a"}<span class="tbar"><span style="width:${barW}%;background:${barColor}"></span></span></span></td>
        <td class="num">${e.uptime ? e.uptime.toFixed(1) + "%" : "n/a"}</td>
        <td><span class="badge ${e.healthy ? "ok" : "bad"}">${e.healthy ? "healthy" : "off"}</span></td>
        <td><button class="sm primary" data-m="${esc(slug)}" data-p="${esc(e.provider)}">use</button></td></tr>`;
    }).join("");
    $$("#ep-rows button[data-m]").forEach(b => b.onclick = () => applyChoice(b.dataset.m, b.dataset.p));
  } catch (e) { toast(e.message, true); }
}

async function applyChoice(model, provider) {
  try {
    const r = await api("/api/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, provider }) });
    toast(`Applied: ${r.model} @ ${r.provider} (${r.gateway})`);
    await loadCommon();
  } catch (e) { toast(e.message, true); }
}

/* ---------------------------------------------------------------- catalog */

const TIER_ORDER = ["free", "budget", "value", "mid", "premium", "ultra"];

function tierBadge(t) {
  const k = TIER_ORDER.includes(t) ? t : "unknown";
  return `<span class="badge tier-${esc(k)}">${esc(t || "unknown")}</span>`;
}

function catParams() {
  const p = { limit: CAT.limit, offset: CAT.offset };
  if (CAT.q) p.q = CAT.q;
  if (CAT.tier) p.tier = CAT.tier;
  if (CAT.family) p.family = CAT.family;
  if (CAT.tag) p.tag = CAT.tag;
  if (CAT.sort) p.sort = CAT.sort;
  return p;
}

function catQS(extra) {
  return new URLSearchParams(Object.entries({ ...catParams(), ...extra })
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => [k, String(v)])).toString();
}

async function refreshRankedModels() {
  try {
    const [md, rk] = await Promise.all([api("/api/models"), api("/api/rank")]);
    MODELS = md.models; RANKED = rk.models;
  } catch (e) {}
}

function viewCatalog() {
  CAT.offset = 0;
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Catalog</h1><div class="sub">The full OpenRouter catalog, classified by tier / family / tag. Add models to your watchlist.</div></div>
      <button class="primary" id="cat-addall"></button>
    </div>
    <div class="panel">
      <div class="cat-toolbar">
        <div class="row-ctl" style="align-items:center;gap:14px">
          <div style="flex:1 1 360px;max-width:420px"><input id="cat-q" placeholder="Search models…" value="${esc(CAT.q)}"></div>
          <div style="flex:0 1 220px"><select id="cat-family"></select></div>
          <div style="flex:0 1 190px"><select id="cat-sort">
              <option value="">relevance</option>
              <option value="price_asc">price ↑</option>
              <option value="price_desc">price ↓</option>
              <option value="name">name</option>
              <option value="ctx_desc">context window ↓</option>
            </select></div>
        </div>
        <div class="facets" id="cat-tiers"></div>
        <div class="facets" id="cat-tags"></div>
      </div>
      <div id="cat-result"><span class="spinner"></span></div>
    </div>`;

  let qDeb;
  $("#cat-q").oninput = () => {
    clearTimeout(qDeb);
    qDeb = setTimeout(() => {
      CAT.q = $("#cat-q").value.trim();
      loadCatalog(true);
    }, 300);
  };
  $("#cat-family").onchange = () => { CAT.family = $("#cat-family").value; loadCatalog(true); };
  $("#cat-sort").onchange = () => { CAT.sort = $("#cat-sort").value; loadCatalog(true); };
  $("#cat-addall").onclick = addAllFiltered;
  loadCatalog(true);
}

async function loadCatalog(reset) {
  if (reset) CAT.offset = 0;
  let r;
  try {
    r = await api("/api/catalog?" + catQS());
  } catch (e) { $("#cat-result").innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  CAT.total = r.total;
  CAT.facets = r.facets;
  CAT.results = reset ? r.results : CAT.results.concat(r.results);
  CAT.offset = CAT.results.length;
  renderCatalogControls();
  renderCatalogTable();
}

function renderCatalogControls() {
  const f = CAT.facets || { tiers: {}, families: {}, tags: {} };
  const tiers = f.tiers || {};
  const keys = TIER_ORDER.filter(k => k in tiers)
    .concat(Object.keys(tiers).filter(k => !TIER_ORDER.includes(k)));
  $("#cat-tiers").innerHTML = `<span class="facet ${!CAT.tier ? "on" : ""}" data-tier="">All<span class="n">${CAT.total}</span></span>` +
    keys.map(k => `<span class="facet ${CAT.tier === k ? "on" : ""}" data-tier="${esc(k)}">${esc(k)}<span class="n">${tiers[k]}</span></span>`).join("");
  const fams = f.families || {};
  $("#cat-family").innerHTML = `<option value="">all families</option>` +
    Object.entries(fams).map(([k, c]) => `<option value="${esc(k)}" ${CAT.family === k ? "selected" : ""}>${esc(k)} (${c})</option>`).join("");
  $("#cat-tags").innerHTML = Object.entries(f.tags || {}).map(([k, c]) =>
    `<span class="facet ${CAT.tag === k ? "on" : ""}" data-tag="${esc(k)}">${esc(k)}<span class="n">${c}</span></span>`).join("");
  $("#cat-addall").textContent = CAT.total ? `Add all (${CAT.total}) filtered` : "Add all (0) filtered";
  $("#cat-addall").disabled = !CAT.total;
  $("#cat-sort").value = CAT.sort;
  $$("#cat-tiers .facet").forEach(el => el.onclick = () => { CAT.tier = el.dataset.tier; loadCatalog(true); });
  $$("#cat-tags .facet").forEach(el => el.onclick = () => { CAT.tag = CAT.tag === el.dataset.tag ? "" : el.dataset.tag; loadCatalog(true); });
}

function catRow(m) {
  return `<tr>
    <td><div class="model-name">${esc(m.id)}</div><div class="model-sub">${esc(m.name || "")}</div></td>
    <td>${tierBadge(m.tier)}</td>
    <td><span class="mini">${esc(m.family || "—")}</span></td>
    <td class="num">${m.ctx ? (m.ctx / 1000).toFixed(1) + "k" : "—"}</td>
    <td class="num">${fmt(m.in_$M)}</td>
    <td class="num">${fmt(m.out_$M)}</td>
    <td>${(m.tags || []).map(t => `<span class="chip" style="margin-right:4px">${esc(t)}</span>`).join("") || '<span class="faint">—</span>'}</td>
    <td>${m.wl ? '<span class="badge ok">✓ in watchlist</span>' : `<button class="sm" data-act="add" data-slug="${esc(m.id)}">+ Add</button>`}</td>
  </tr>`;
}

function renderCatalogTable() {
  const rows = CAT.results;
  $("#cat-result").innerHTML = `
    <div class="hint" style="margin:0 0 8px">${CAT.total} result${CAT.total === 1 ? "" : "s"} · showing ${rows.length}</div>
    <div style="overflow:auto"><table>
      <thead><tr><th>Model</th><th>Tier</th><th>Family</th><th class="num">ctx</th><th class="num">in $/M</th><th class="num">out $/M</th><th>Tags</th><th></th></tr></thead>
      <tbody>${rows.map(catRow).join("")}</tbody>
    </table></div>
    ${CAT.offset < CAT.total ? `<div style="text-align:center;margin-top:14px"><button id="cat-loadmore">Load more (${CAT.total - CAT.offset} more)</button></div>` : ""}`;
  $$("#cat-result button[data-act='add']").forEach(b => b.onclick = async () => {
    try {
      await api("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: b.dataset.slug }) });
      const m = CAT.results.find(x => x.id === b.dataset.slug);
      if (m) m.wl = true;
      toast("Added: " + b.dataset.slug);
      await refreshRankedModels();
      renderCatalogTable();
    } catch (e) { toast(e.message, true); }
  });
  const lm = $("#cat-loadmore");
  if (lm) lm.onclick = () => loadCatalog(false);
}

async function addAllFiltered() {
  const ids = [];
  const p = { limit: 200, offset: 0 };
  if (CAT.q) p.q = CAT.q;
  if (CAT.tier) p.tier = CAT.tier;
  if (CAT.family) p.family = CAT.family;
  if (CAT.tag) p.tag = CAT.tag;
  try {
    for (let offset = 0; ;) {
      const r = await api("/api/catalog?" + catQS({ ...p, offset }));
      r.results.forEach(m => ids.push(m.id));
      CAT.total = r.total;
      offset += r.results.length;
      if (offset >= r.total) break;
    }
    if (!ids.length) { toast("nothing to add", true); return; }
    const res = await api("/api/models/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slugs: ids }) });
    toast(`Added ${res.added}, skipped ${res.skipped}`);
    const set = new Set(ids);
    CAT.results.forEach(m => { if (set.has(m.id)) m.wl = true; });
    await refreshRankedModels();
    renderCatalogTable();
  } catch (e) { toast(e.message, true); }
}

/* -------------------------------------------------------------- providers */

function fmtGauge(v, kind) {
  if (kind === "usd") return "$" + Number(v).toFixed(4);
  const n = Math.round(Number(v));
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function gaugeHtml(s, kind) {
  const pct = Math.min(100, Math.round(s.pct || 0));
  const color = s.exhausted ? "var(--red)" : pct >= 80 ? "var(--amber)" : "var(--green)";
  const maxTxt = s.max == null ? "∞" : fmtGauge(s.max, kind);
  return `<div class="gauge" style="text-align:left">
    <div class="g-top"><span>${fmtGauge(s.used, kind)} / ${maxTxt}</span><span style="color:${color}">${s.exhausted ? 100 : pct}%</span></div>
    <div class="g-bar"><span style="width:${s.exhausted ? 100 : pct}%;background:${color}"></span></div>
    <div class="g-bot"><span>left ${s.remaining == null ? "—" : fmtGauge(s.remaining, kind)}</span></div>
  </div>`;
}

function provStatusBadge(p) {
  const st = p.status || {};
  if (p.blocked) return '<span class="badge bad">BLOCKED</span>';
  if (st.requests && st.requests.exhausted || st.tokens && st.tokens.exhausted || st.spend && st.spend.exhausted)
    return '<span class="badge bad">EXHAUSTED</span>';
  if (Object.keys(p.limits || {}).length) return '<span class="badge ok">OK</span>';
  return '<span class="badge neut">no limits</span>';
}

function resetPer(st) {
  for (const k of ["requests", "tokens", "spend"]) {
    if (st[k] && st[k].per) return st[k].per;
  }
  return "";
}

function fmtDur(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function resetInLabel(per) {
  if (!per || per === "total") return "—";
  const now = new Date();
  if (per === "day") {
    const mid = new Date(now); mid.setHours(24, 0, 0, 0);
    return fmtDur(mid - now);
  }
  const nxt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return fmtDur(nxt - now);
}

function winTable(p, w) {
  const u = (p.usage || {})[w];
  const head = `<div class="k" style="font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)">${w}${u && u.window ? " · " + esc(u.window) : ""}</div>`;
  if (!u || !Object.keys(u).length) return `<div>${head}<div class="empty">no usage</div></div>`;
  return `<div>${head}
    <table style="font-size:12px"><thead><tr><th class="num">req</th><th class="num">in</th><th class="num">out</th><th class="num">spend</th></tr></thead>
    <tbody><tr><td class="num">${u.requests ?? 0}</td><td class="num">${fmtGauge(u.tokens_in || 0, "tok")}</td><td class="num">${fmtGauge(u.tokens_out || 0, "tok")}</td><td class="num">$${(Number(u.spend) || 0).toFixed(4)}</td></tr></tbody></table>
  </div>`;
}

function viewProviders() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Providers</h1><div class="sub">Budget limits & usage per provider. Exhausted or blocked providers are auto-skipped by the router.</div></div>
      <div style="display:flex;gap:8px"><button class="ghost" id="btn-padd">+ Add provider</button><button class="ghost" id="btn-prefresh">↻ Refresh</button></div>
    </div>
    <div class="panel">
      <div style="margin-bottom:12px;max-width:340px"><input id="prov-filter" placeholder="filter providers…"></div>
      <div style="overflow:auto">
        <table>
          <thead><tr>
            <th>Provider</th><th>Status</th>
            <th class="num">Day requests</th><th class="num">Day tokens</th><th class="num">Day spend</th>
            <th class="num">Reset in</th><th>Last used</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody id="prov-rows"></tbody>
        </table>
      </div>
      <div id="prov-count" class="hint" style="margin-top:10px"></div>
    </div>`;
  $("#btn-prefresh").onclick = loadProviders;
  $("#btn-padd").onclick = async () => {
    const name = prompt("Provider name (e.g. OpenRouter, Baidu):");
    if (!name || !name.trim()) return;
    try {
      await api("/api/providers/" + encodeURIComponent(name.trim()), { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
      toast("Provider added: " + name.trim());
      loadProviders();
    } catch (e) { toast(e.message, true); }
  };
  $("#prov-filter").oninput = renderProvidersTable;
  loadProviders();
}

async function loadProviders() {
  try {
    const d = await api("/api/providers");
    PROVIDERS = d.providers || [];
    CHAIN_AVAIL = availMapFrom(PROVIDERS);
  } catch (e) { toast(e.message, true); }
  renderProvidersTable();
}

function renderProvidersTable() {
  const q = ($("#prov-filter").value || "").trim().toLowerCase();
  const list = PROVIDERS.filter(p => !q || p.name.toLowerCase().includes(q));
  $("#prov-rows").innerHTML = list.map((p, i) => {
    const st = p.status || {};
    const rs = st.requests, ts = st.tokens, ss = st.spend;
    const hasLimits = Object.keys(p.limits || {}).length > 0;
    const note = hasLimits
      ? (p.note ? esc(p.note) : "&nbsp;")
      : `<span style="color:var(--faint);font-size:11.5px">no limits — configure via Edit</span>`;
    const det = `<div class="detail-box"><div class="grid3">${winTable(p, "month")}${winTable(p, "total")}<div></div></div></div>`;
    return `
      <tr>
        <td><div class="model-name expand-toggle" data-toggle="exp-${i}" style="cursor:pointer">${esc(p.name)}</div>
          <div style="font-size:11.5px;font-family:var(--mono)">${note}</div></td>
        <td>${provStatusBadge(p)}</td>
        <td class="num">${rs ? gaugeHtml(rs, "req") : '<span class="faint">—</span>'}</td>
        <td class="num">${ts ? gaugeHtml(ts, "tok") : '<span class="faint">—</span>'}</td>
        <td class="num">${ss ? gaugeHtml(ss, "usd") : '<span class="faint">—</span>'}</td>
        <td class="num">${resetInLabel(resetPer(st))}</td>
        <td class="mini">${esc(st.last_used || "never")}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="sm" data-act="block" data-p="${esc(p.name)}">${p.blocked ? "✓ Unblock" : "⛔ Block"}</button>
          <button class="sm ghost" data-act="reset" data-p="${esc(p.name)}">Reset</button>
          <button class="sm primary" data-act="edit" data-p="${esc(p.name)}">Edit</button>
        </td>
      </tr>
      <tr class="expand-row" id="exp-${i}" style="display:none"><td colspan="8">${det}</td></tr>`;
  }).join("") || `<tr><td colspan="8"><div class="empty">no providers configured — add one with + Add provider, or set limits via Edit on a provider</div></td></tr>`;
  $("#prov-count").textContent = `${list.length} of ${PROVIDERS.length} provider${PROVIDERS.length === 1 ? "" : "s"}`;

  $$("#prov-rows [data-act]").forEach(btn => btn.onclick = async () => {
    const name = btn.dataset.p, act = btn.dataset.act;
    try {
      if (act === "block") {
        const p = PROVIDERS.find(x => x.name === name);
        await api("/api/providers/" + encodeURIComponent(name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocked: !p.blocked }) });
        toast((p.blocked ? "Unblocked" : "Blocked") + ": " + name);
        loadProviders();
      } else if (act === "reset") {
        if (!confirm("Reset usage counters for " + name + "?")) return;
        await api("/api/providers/" + encodeURIComponent(name) + "/reset", { method: "POST" });
        toast("Usage reset: " + name);
        loadProviders();
      } else if (act === "edit") {
        openEditModal(PROVIDERS.find(x => x.name === name) || { name, note: "", limits: {}, status: {} });
      }
    } catch (e) { toast(e.message, true); }
  });
  $$("#prov-rows .expand-toggle").forEach(el => el.onclick = () => {
    const tr = document.getElementById(el.dataset.toggle);
    if (tr) tr.style.display = (tr.style.display === "none" ? "" : "none");
  });
}

function openEditModal(p) {
  const cur = p.limits || {};
  const ov = document.createElement("div");
  ov.className = "modal";
  ov.innerHTML = `
    <div class="modal-card">
      <h3>${esc(p.name)}</h3>
      <div class="sub">Budget limits let the router auto-skip this provider once a limit is reached. Limits merge per type.</div>
      <div><label class="field">Note</label>
        <textarea id="m-note" rows="2" placeholder="note…">${esc(p.note || "")}</textarea></div>
      ${["requests", "tokens", "spend"].map(t => {
        const c = cur[t] || {};
        return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:10px">
          <label class="switch"><input type="checkbox" id="m-${t}-on" ${c.per ? "checked" : ""}> <b style="text-transform:capitalize">${t}</b></label>
          <div class="row-ctl" style="margin-top:8px">
            <div style="max-width:150px"><label class="field">per</label>
              <select id="m-${t}-per"><option value="day" ${c.per === "day" ? "selected" : ""}>day</option><option value="month" ${c.per === "month" ? "selected" : ""}>month</option><option value="total" ${c.per === "total" ? "selected" : ""}>total</option></select></div>
            <div><label class="field">max</label><input type="number" id="m-${t}-max" step="any" min="0" placeholder="${t === "spend" ? "USD" : "count"}" value="${c.max != null ? c.max : ""}"></div>
          </div>
        </div>`;
      }).join("")}
      <div style="display:flex;gap:10px;margin-top:16px;align-items:center;justify-content:space-between;flex-wrap:wrap">
        <button class="sm danger" id="m-del">Delete provider entry</button>
        <div style="display:flex;gap:10px">
          <button class="ghost" id="m-cancel">Cancel</button>
          <button class="primary" id="m-save">Save</button>
        </div>
      </div>
      <div class="hint" style="margin-top:8px">A checked limit with an empty max tracks usage without a cap. Already-configured limits keep their type even when unchecked (backend merges).</div>
    </div>`;
  const close = () => ov.remove();
  ov.addEventListener("click", ev => { if (ev.target === ov) close(); });
  $("#m-cancel", ov).onclick = close;
  $("#m-del", ov).onclick = async () => {
    if (!confirm("Delete provider entry " + p.name + "?")) return;
    try {
      await api("/api/providers/" + encodeURIComponent(p.name), { method: "DELETE" });
      toast("Deleted: " + p.name);
      close(); loadProviders();
    } catch (e) { toast(e.message, true); }
  };
  $("#m-save", ov).onclick = async () => {
    const limits = {};
    for (const t of ["requests", "tokens", "spend"]) {
      if (!ov.querySelector("#m-" + t + "-on").checked) continue;
      const conf = { per: ov.querySelector("#m-" + t + "-per").value };
      const mx = parseFloat(ov.querySelector("#m-" + t + "-max").value);
      if (Number.isFinite(mx) && mx >= 0) conf.max = mx;
      limits[t] = conf;
    }
    try {
      await api("/api/providers/" + encodeURIComponent(p.name), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: ov.querySelector("#m-note").value, limits })
      });
      toast("Saved: " + p.name);
      close(); loadProviders();
    } catch (e) { toast(e.message, true); }
  };
  document.body.appendChild(ov);
  ov.querySelector("#m-note").focus();
}

function ovProviderRows(provs) {
  if (!provs.length) return `<div class="empty"><a href="#/providers" style="color:var(--green)">No providers configured — add limits</a></div>`;
  const day = p => ((p.usage || {}).day || {}).requests || 0;
  const withLimits = provs.filter(p => Object.keys(p.limits || {}).length);
  const top = withLimits.slice().sort((a, b) => day(b) - day(a)).slice(0, 4);
  const list = top.length ? top : provs.slice(0, 4);
  return list.map(p => {
    const st = p.status || {};
    const rs = st.requests;
    const ex = p.blocked || (st.requests && st.requests.exhausted) || (st.tokens && st.tokens.exhausted) || (st.spend && st.spend.exhausted);
    return `<div class="bar-row">
      <span class="nm">${esc(p.name)}</span>
      ${ex ? '<span class="badge bad">EXHAUSTED</span>' : ""}
      <span class="gauge">${rs && rs.max != null ? gaugeHtml(rs, "req") : '<span class="faint" style="font-size:11px">no limit</span>'}</span>
    </div>`;
  }).join("");
}

/* ---------------------------------------------------------------- chains */

function availMapFrom(providers) {
  const m = {};
  (providers || []).forEach(p => {
    const st = p.status || {};
    m[p.name] = {
      blocked: !!p.blocked,
      exhausted: !!(st.requests && st.requests.exhausted) || !!(st.tokens && st.tokens.exhausted) || !!(st.spend && st.spend.exhausted),
      note: p.note || "",
    };
  });
  return m;
}

function availDot(name) {
  const a = CHAIN_AVAIL[name];
  if (!a) return '<span class="dot" style="background:var(--line-strong);width:5px;height:5px"></span>';
  if (a.blocked || a.exhausted) return '<span class="dot bad" style="width:5px;height:5px"></span>';
  return '<span class="dot ok" style="width:5px;height:5px"></span>';
}

function entryProvs(e) {
  if (e.providers && e.providers.length) return e.providers;
  if (e.provider && e.provider !== "auto") return [e.provider];
  return [];
}

function chainFlowNode(e, i) {
  const provs = entryProvs(e);
  const chips = provs.length ? `<div class="chips" style="margin-top:4px">${provs.map(p => `<span class="chip">${availDot(p)}${esc(p)}</span>`).join("")}</div>` : "";
  const autoTxt = provs.length ? "" : `<div class="p">@ auto</div>`;
  if (e.type === "cheapest") {
    return `<div class="chain-node"><div class="t">#${i + 1}</div><div class="m">★ cheapest ${esc(e.filter || "in watchlist")}</div>${chips || autoTxt}</div>`;
  }
  return `<div class="chain-node"><div class="t">#${i + 1}</div><div class="m">${esc(e.model)}</div>${chips || autoTxt}</div>`;
}

function chainEntryRow(c, ci, e, i) {
  const provs = entryProvs(e);
  const isCheap = e.type === "cheapest";
  const label = isCheap ? `★ cheapest ${esc(e.filter || "in watchlist")}` : esc(e.model);
  const chips = provs.length
    ? `<span class="chips" style="margin-left:6px">${provs.map(p => `<span class="chip">${availDot(p)}${esc(p)}<span class="rm" data-act="chipdel" data-ci="${ci}" data-ei="${i}" data-p="${esc(p)}">✕</span></span>`).join("")}</span>`
    : "";
  return `<div class="chain-entry-row">
    <span class="idx">${i + 1}</span>
    <span class="grow mono" style="font-size:12.5px">
      ${label}${chips}
      <button class="sm ghost" style="margin-left:6px" data-act="provadd" data-ci="${ci}" data-ei="${i}" data-slug="${isCheap ? "" : esc(e.model)}">+ ${isCheap ? "restrict" : "provider"}</button>
    </span>
    <input class="entry-note" data-ci="${ci}" data-ei="${i}" placeholder="note…" value="${esc(e.note || "")}">
    <button class="sm" data-act="up" data-ci="${ci}" data-ei="${i}" ${i === 0 ? "disabled" : ""}>↑</button>
    <button class="sm" data-act="down" data-ci="${ci}" data-ei="${i}" ${i === c.entries.length - 1 ? "disabled" : ""}>↓</button>
    <button class="sm danger" data-act="del" data-ci="${ci}" data-ei="${i}">✕</button>
  </div>`;
}

async function viewChains() {
  try {
    const pr = await api("/api/providers");
    CHAIN_AVAIL = availMapFrom(pr.providers || []);
  } catch (e) { CHAIN_AVAIL = {}; }
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Fallback chains</h1><div class="sub">Ordered pipelines. The primary chain drives your config; the engine walks it top → bottom and uses the first healthy step. Provider chips on a step = hard preference (first available one wins).</div></div>
      <button class="primary" id="btn-newchain">+ New chain</button>
    </div>
    <div id="chains-list"></div>`;
  renderChains();
  $("#btn-newchain").onclick = async () => {
    const name = prompt("Chain name:");
    if (!name) return;
    try {
      await api("/api/chains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, entries: [] }) });
      toast("Chain created: " + name);
      CHAINS = (await api("/api/chains")).chains;
      renderChains();
    } catch (e) { toast(e.message, true); }
  };
  document.addEventListener("click", function chClose(ev) {
    if (!ev.target.closest(".chain-entry-row")) {
      $$("#chains-list .chain-entry-row .ac-list.show").forEach(d => d.remove());
      document.removeEventListener("click", chClose);
    }
  });
}

function renderChains() {
  $("#chains-list").innerHTML = CHAINS.map((c, ci) => `
    <div class="panel">
      <h2>${esc(c.name)} ${c.primary ? '<span class="badge ok">PRIMARY</span>' : ""} ${c.auto_apply ? '<span class="badge info">auto-apply</span>' : '<span class="badge warn">manual</span>'}</h2>
      <div class="chain-note-wrap" data-ci="${ci}">
        ${c.note ? `<textarea class="chain-note" data-ci="${ci}" rows="2" placeholder="Add a note…">${esc(c.note)}</textarea>`
                 : `<button class="sm ghost" data-act="noteadd" data-ci="${ci}">+ Add a note…</button>`}
      </div>
      <div class="chain-flow">${c.entries.length ? c.entries.map((e, i) => chainFlowNode(e, i) +
            (i < c.entries.length - 1 ? '<span class="chain-arrow">→</span>' : "")).join("") : '<span class="empty">No entries yet — add one below.</span>'}</div>
      <div style="margin-top:10px">${c.entries.map((e, i) => chainEntryRow(c, ci, e, i)).join("")}</div>
      <div class="row-ctl" style="margin-top:12px">
        <div><label class="field">Add step — model</label>
          <div class="autocomplete"><input id="ac-${ci}" placeholder="search models…">
            <div class="ac-list" id="acl-${ci}"></div></div></div>
        <div style="max-width:170px"><label class="field">Provider</label>
          <select id="prov-${ci}"><option value="auto">auto (cheapest healthy)</option></select></div>
        <div style="max-width:150px;align-self:end"><button id="add-${ci}">+ Add step</button></div>
        <div style="max-width:150px;align-self:end"><button id="cheap-${ci}">+ Cheapest</button></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <label class="switch"><input type="checkbox" id="aa-${ci}" ${c.auto_apply ? "checked" : ""}> auto-apply</label>
        <button class="sm" data-act="primary" data-ci="${ci}" ${c.primary ? "disabled" : ""}>Set as primary</button>
        <button class="sm danger" data-act="delchain" data-ci="${ci}">Delete chain</button>
      </div>
    </div>`).join("");

  $$("#chains-list [data-act]").forEach(b => b.onclick = () => chainAction(b.dataset));

  $$("#chains-list .chain-note").forEach(ta => {
    ta.onblur = async () => {
      const c = CHAINS[+ta.dataset.ci];
      if (c.note === ta.value) return;
      c.note = ta.value;
      try {
        await api("/api/chains/" + encodeURIComponent(c.name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
        toast("Note saved");
        CHAINS = (await api("/api/chains")).chains;
        renderChains();
      } catch (e) { toast(e.message, true); }
    };
  });

  $$("#chains-list .entry-note").forEach(inp => {
    inp.onchange = async () => {
      const c = CHAINS[+inp.dataset.ci];
      c.entries[+inp.dataset.ei].note = inp.value;
      await saveChain(c);
    };
  });

  $$("#chains-list [data-act='provadd']").forEach(btn => {
    btn.onclick = async () => {
      const ci = +btn.dataset.ci, ei = +btn.dataset.ei;
      const row = btn.closest(".chain-entry-row");
      closeProvDropdowns();
      let items = [];
      if (btn.dataset.slug) {
        const d = await api("/api/endpoints/" + encodeURIComponent(btn.dataset.slug)).catch(() => null);
        if (d) items = (d.endpoints || []).filter(e => e && !e.error).map(e => ({
          name: e.provider, dot: e.available ? "ok" : "bad", sub: fmt(e.blended) + " $/M"
        }));
      } else {
        items = Object.entries(CHAIN_AVAIL).map(([n, a]) => ({
          name: n, dot: (a.blocked || a.exhausted) ? "bad" : "ok", sub: a.note || ""
        }));
      }
      if (!row || !items.length) { toast("no provider options", true); return; }
      const dd = document.createElement("div");
      dd.className = "ac-list show";
      dd.style.cssText = "position:absolute;top:100%;left:0;min-width:240px;z-index:45";
      dd.innerHTML = items.map(it =>
        `<div class="ac-item" data-p="${esc(it.name)}"><span class="n"><span class="dot ${it.dot}"></span> ${esc(it.name)}</span><div class="d">${esc(it.sub)}</div></div>`).join("");
      dd.querySelectorAll(".ac-item").forEach(it => it.onclick = async () => {
        const c = CHAINS[ci];
        const entry = c.entries[ei];
        entry.providers = entry.providers || [];
        if (!entry.providers.includes(it.dataset.p)) entry.providers.push(it.dataset.p);
        await saveChain(c);
        toast("Provider preference set");
      });
      row.style.position = "relative";
      row.appendChild(dd);
    };
  });

  CHAINS.forEach((c, ci) => {
    const input = $("#ac-" + ci), list = $("#acl-" + ci), sel = $("#prov-" + ci);
    let deb;
    input.oninput = () => {
      clearTimeout(deb);
      deb = setTimeout(async () => {
        const q = input.value.trim();
        if (q.length < 2) { list.classList.remove("show"); return; }
        const r = await api("/api/catalog?q=" + encodeURIComponent(q));
        list.innerHTML = r.results.map(m =>
          `<div class="ac-item" data-slug="${esc(m.id)}"><span class="n">${esc(m.id)}</span><div class="d">${esc(m.name || "")}</div></div>`).join("")
          || '<div class="ac-item faint">no match</div>';
        list.classList.add("show");
        $$(".ac-item[data-slug]", list).forEach(it => it.onclick = () => {
          input.value = it.dataset.slug;
          fillProviders(ci, it.dataset.slug);
          list.classList.remove("show");
        });
      }, 250);
    };
    $("#add-" + ci).onclick = async () => {
      const slug = input.value.trim();
      if (!slug) { toast("Pick a model first", true); return; }
      const e = { type: "model", model: slug };
      if (sel.value !== "auto") e.providers = [sel.value];
      c.entries.push(e);
      await saveChain(c);
      toast("Step added");
    };
    $("#cheap-" + ci).onclick = async () => {
      c.entries.push({ type: "cheapest" });
      await saveChain(c);
    };
    $("#aa-" + ci).onchange = async ev => {
      c.auto_apply = ev.target.checked;
      await api("/api/chains/" + encodeURIComponent(c.name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      CHAINS = (await api("/api/chains")).chains;
      renderChains();
    };
  });
}

function closeProvDropdowns() {
  $$("#chains-list .chain-entry-row .ac-list.show").forEach(dd => dd.remove());
}

async function fillProviders(ci, slug) {
  const sel = $("#prov-" + ci);
  sel.innerHTML = '<option value="auto">auto (cheapest healthy)</option>';
  try {
    const d = await api("/api/endpoints/" + encodeURIComponent(slug));
    d.endpoints.forEach(e => {
      if (e.error) return;
      sel.insertAdjacentHTML("beforeend", `<option value="${esc(e.provider)}">${esc(e.provider)} — ${fmt(e.blended)} $/M</option>`);
    });
  } catch (err) {}
}

async function saveChain(c) {
  await api("/api/chains/" + encodeURIComponent(c.name), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
  CHAINS = (await api("/api/chains")).chains;
  renderChains();
}

async function chainAction(d) {
  const c = CHAINS[+d.ci];
  if (d.act === "del") {
    c.entries.splice(+d.ei, 1);
    await saveChain(c);
  } else if (d.act === "chipdel") {
    const e = c.entries[+d.ei];
    e.providers = (e.providers || []).filter(x => x !== d.p);
    if (e.provider && e.provider !== "auto" && e.provider === d.p) delete e.provider;
    await saveChain(c);
  } else if (d.act === "noteadd") {
    const wrap = document.querySelector(`.chain-note-wrap[data-ci="${d.ci}"]`);
    if (!wrap) return;
    wrap.innerHTML = `<textarea class="chain-note" data-ci="${d.ci}" rows="2" placeholder="Add a note…"></textarea>`;
    const ta = wrap.querySelector("textarea");
    ta.focus();
    ta.onblur = async () => {
      const cc = CHAINS[+d.ci];
      cc.note = ta.value;
      await saveChain(cc);
      toast("Note saved");
    };
  } else if (d.act === "up") {
    [c.entries[+d.ei - 1], c.entries[+d.ei]] = [c.entries[+d.ei], c.entries[+d.ei - 1]];
    await saveChain(c);
  } else if (d.act === "down") {
    [c.entries[+d.ei + 1], c.entries[+d.ei]] = [c.entries[+d.ei], c.entries[+d.ei + 1]];
    await saveChain(c);
  } else if (d.act === "primary") {
    await api("/api/chains/" + encodeURIComponent(c.name) + "/primary", { method: "POST" });
    CHAINS = (await api("/api/chains")).chains;
    renderChains();
    toast(c.name + " is now the primary chain");
  } else if (d.act === "delchain") {
    try {
      await api("/api/chains/" + encodeURIComponent(c.name), { method: "DELETE" });
      CHAINS = (await api("/api/chains")).chains;
      renderChains();
    } catch (e) { toast(e.message, true); }
  }
}

/* -------------------------------------------------------------- API page */

async function viewApi() {
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>API endpoint</h1>
      <div class="sub">OpenAI-compatible. Point any client (openai SDK, LangChain, curl) at JAR and it routes through your chains.</div></div></div>
    <div class="panel"><h2>Base URL</h2>
      <div class="row-ctl">
        <div><label class="field">On this machine</label><input readonly value="http://localhost:8490/v1" id="url-local"></div>
        <div><label class="field">From LAN / Tailscale</label><input readonly value="http://YOUR-IP:8490/v1" id="url-lan"></div>
        <div style="max-width:120px;align-self:end"><button id="btn-copy-url">Copy LAN</button></div>
      </div>
      <div class="hint" style="margin-top:8px">Reachable on all interfaces (0.0.0.0). From another device use the Tailscale IP or LAN IP of this machine — same port.</div>
    </div>
    <div class="panel"><h2>Routing now</h2><div id="resolve-box"><span class="spinner"></span></div></div>
    <div class="panel"><h2>API keys</h2>
      <div class="row-ctl" style="max-width:520px">
        <div><label class="field">Key name</label><input id="key-name" placeholder="e.g. my-laptop"></div>
        <div style="max-width:130px;align-self:end"><button class="primary" id="btn-newkey">Create key</button></div>
      </div>
      <div id="newkey-box" style="display:none;margin-top:12px">
        <div class="hint" style="margin-bottom:6px">Copy it now — it will not be shown again.</div>
        <div class="row-ctl"><div><input readonly id="newkey-val" class="mono"></div>
        <div style="max-width:120px;align-self:end"><button id="btn-copy-key">Copy</button></div></div>
      </div>
      <div id="keys-list" style="margin-top:14px"></div>
    </div>
    <div class="panel"><h2>Usage</h2>
      <div class="hint" style="margin-bottom:8px">model field: <span class="mono">"penny"</span> = primary chain · <span class="mono">"penny:free-first"</span> = a named chain · any real model id = that model, routed to its cheapest healthy provider.</div>
      <label class="field">curl</label>
      <pre class="mono" id="ex-curl" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;overflow:auto"></pre>
      <label class="field">Python (openai SDK)</label>
      <pre class="mono" id="ex-py" style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;overflow:auto"></pre>
    </div>`;

  const host = location.host || "localhost:8490";
  $("#url-local").value = "http://" + host + "/v1";
  $("#url-lan").value = "http://" + host.split(":")[0] + ":8490/v1   (replace with Tailscale/LAN IP of this machine)";
  $("#btn-copy-url").onclick = () => { navigator.clipboard.writeText("http://" + host.split(":")[0] + ":8490/v1"); toast("Base URL copied"); };

  try {
    const r = await api("/api/resolve");
    const res = r.resolution;
    $("#resolve-box").innerHTML = res
      ? `<div class="pill ok"><span class="dot"></span> ${esc(res.model)} @ ${esc(res.provider)} — ${fmt(res.blended)} $/M blended</div>
         <div class="hint" style="margin-top:6px">Reason: ${esc(res.reason)} · via chain "${esc(res.model && r.resolution ? '' : '')}"</div>`
      : '<span class="badge warn">no healthy resolution</span>';
  } catch (e) { $("#resolve-box").innerHTML = '<span class="badge bad">resolve failed</span>'; }

  const loadKeys = async () => {
    const d = await api("/api/keys");
    $("#keys-list").innerHTML = d.keys.length ? `<table><thead><tr><th>Name</th><th>Key</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>` +
      d.keys.map(k => `<tr><td><b>${esc(k.name)}</b></td><td class="mono">${esc(k.prefix)}…</td><td class="mini">${esc(k.created)}</td><td class="mini">${esc(k.last_used || "never")}</td>
        <td><button class="sm danger" data-id="${esc(k.id)}">revoke</button></td></tr>`).join("") + "</tbody></table>"
      : '<div class="empty">No keys yet — create one.</div>';
    $$("#keys-list button[data-id]").forEach(b => b.onclick = async () => {
      await api("/api/keys/" + b.dataset.id, { method: "DELETE" });
      toast("Key revoked");
      loadKeys();
    });
  };
  await loadKeys();

  $("#btn-newkey").onclick = async () => {
    try {
      const r = await api("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: $("#key-name").value || "default" }) });
      $("#newkey-box").style.display = "";
      $("#newkey-val").value = r.key;
      $("#btn-copy-key").onclick = () => { navigator.clipboard.writeText(r.key); toast("Key copied"); };
      loadKeys();
    } catch (e) { toast(e.message, true); }
  };

  const base = "http://" + host + "/v1";
  $("#ex-curl").textContent = `curl ${base}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: pnk-YOUR-KEY" \\
  -d '{
    "model": "penny",
    "messages": [{"role": "user", "content": "hello"}],
    "stream": false
  }'`;
  $("#ex-py").textContent = `from openai import OpenAI

client = OpenAI(base_url="${base}", api_key="pnk-YOUR-KEY")

r = client.chat.completions.create(
    model="penny",   # primary chain; or "penny:free-first", or a model id
    messages=[{"role": "user", "content": "hello"}],
)
print(r.model)  # resolved model id; response also carries .pennyroute.served_by`;
}

/* ------------------------------------------------------------------ chat */

function viewChat() {
  const savedKey = localStorage.getItem("penny_key") || "";
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Chat</h1>
      <div class="sub">Talk to the router from any device on Tailscale / LAN. Key stays in this browser (localStorage), never on the server.</div></div></div>
    <div class="panel" style="padding:14px 18px">
      <div class="row-ctl">
        <div><label class="field">JAR API key</label>
          <input type="password" id="chat-key" placeholder="pnk-…" value="${esc(savedKey)}" class="mono"></div>
        <div style="min-width:300px"><label class="field">Route — fallback chain or model</label>
          <select id="chat-model">
            <optgroup label="Fallback chains">
              <option value="penny">★ penny — primary chain</option>
              ${CHAINS.filter(c => !c.primary).map(c => `<option value="penny:${esc(c.name)}">→ penny:${esc(c.name)}</option>`).join("")}
            </optgroup>
            <optgroup label="Single models">
              <option value="__ids__">— pick a model —</option>
            </optgroup>
          </select></div>
        <div style="max-width:300px" id="chat-model-wrap" style="display:none"><label class="field">Model</label>
          <select id="chat-model-id"></select></div>
      </div>
      <div class="hint" style="margin-top:6px">Create keys in <a href="#/api" style="color:var(--accent)">API endpoint</a>.</div>
    </div>
    <div class="panel" style="padding:0">
      <div id="chat-log" style="padding:16px 18px;min-height:280px;max-height:60vh;overflow:auto"></div>
      <div style="border-top:1px solid var(--border);padding:12px 16px;display:flex;gap:10px">
        <input id="chat-input" placeholder="Type a message. Enter sends." autocomplete="off">
        <button class="primary" id="chat-send" style="flex:none">Send</button>
      </div>
    </div>
    <div class="panel" id="chat-meta" style="display:none"></div>`;

  const log = $("#chat-log");
  const input = $("#chat-input");
  const modelSel = $("#chat-model"), modelIdSel = $("#chat-model-id"), wrap = $("#chat-model-wrap");
  let history = [];

  modelSel.onchange = async () => {
    if (modelSel.value === "__ids__") {
      wrap.style.display = "";
      modelIdSel.innerHTML = '<option>loading…</option>';
      try {
        const key = $("#chat-key").value.trim();
        const d = await fetch("/v1/models", { headers: { "X-API-Key": key } }).then(r => r.json());
        const chains = (d.data || []).filter(m => m.id.startsWith("penny") && m.owned_by.includes("chain"));
        const models = (d.data || []).filter(m => !m.owned_by.includes("chain"));
        const escOpt = m => `<option value="${esc(m.id)}">${esc(m.id)}${m.owned_by === "pennyroute-primary" ? " ★primary" : ""}</option>`;
        modelIdSel.innerHTML =
          (chains.length ? '<optgroup label="Fallback chains">' + chains.map(escOpt).join("") + "</optgroup>" : "")
          + '<optgroup label="Models">' + models.map(escOpt).join("") + "</optgroup>";
      } catch (e) { modelIdSel.innerHTML = '<option value="penny">penny</option>'; }
    } else wrap.style.display = "none";
  };

  const bubble = (role, text, meta) => {
    const el = document.createElement("div");
    el.style.cssText = "margin:10px 0;display:flex;" + (role === "user" ? "justify-content:flex-end" : "justify-content:flex-start");
    const b = document.createElement("div");
    b.style.cssText = `max-width:78%;border-radius:12px;padding:10px 14px;font-size:13.5px;white-space:pre-wrap;
      background:${role === "user" ? "var(--accent-dim)" : "var(--surface2)"};border:1px solid var(--border2)`;
    b.textContent = text;
    el.appendChild(b);
    if (meta) {
      const m = document.createElement("div");
      m.style.cssText = "font-size:10.5px;color:var(--faint);margin-top:4px;font-family:var(--mono)";
      m.textContent = meta;
      el.appendChild(m);
    }
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  const send = async () => {
    const key = $("#chat-key").value.trim();
    if (!key) { toast("Insert your API key first", true); return; }
    localStorage.setItem("penny_key", key);
    const text = input.value.trim();
    if (!text) return;
    const model = modelSel.value === "__ids__" ? modelIdSel.value : modelSel.value;
    input.value = "";
    bubble("user", text);
    history.push({ role: "user", content: text });
    const btn = $("#chat-send"); btn.disabled = true;
    const thinking = bubble("assistant", "…");
    try {
      const r = await fetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify({ model, messages: history, max_tokens: 2048 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || r.status);
      const content = d.choices?.[0]?.message?.content || "(empty)";
      thinking.textContent = content;
      history.push({ role: "assistant", content });
      const sb = d.pennyroute?.served_by;
      $("#chat-meta").style.display = "";
      $("#chat-meta").innerHTML = `<span class="pill ok"><span class="dot"></span> served by ${esc(sb || d.model || "?")}</span>`;
    } catch (e) {
      thinking.textContent = "Error: " + e.message;
      thinking.style.color = "var(--red)";
    }
    btn.disabled = false;
    input.focus();
  };
  $("#chat-send").onclick = send;
  input.onkeydown = ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } };
}

/* ---------------------------------------------------------------- models */

function viewModels() {
  $("#view").innerHTML = `
    <div class="page-head">
      <div><h1>Watchlist</h1><div class="sub">Models ranked by the engine. Add any OpenRouter model — the ranking covers its providers.</div></div>
    </div>
    <div class="panel"><h2><span class="k">Presets</span> — one-click watchlists</h2>
      <div id="preset-box" style="display:flex;gap:10px;flex-wrap:wrap"><span class="spinner"></span></div>
    </div>
    <div class="panel"><h2>Add model</h2>
      <div class="autocomplete" style="max-width:560px">
        <input id="model-search" placeholder="Type to search 468+ models (e.g. kimi, glm, deepseek)…">
        <div class="ac-list" id="model-ac"></div>
      </div></div>
    <div class="panel"><h2>${MODELS.length} models</h2>
      <table><thead><tr><th>Slug</th><th>Note</th><th></th></tr></thead>
      <tbody>${MODELS.map(m => `<tr><td class="mono">${esc(m.slug)}</td>
        <td style="min-width:260px"><input class="note-inline" data-slug="${esc(m.slug)}" placeholder="note…" value="${esc(m.note || "")}"></td>
        <td><button class="sm danger" data-slug="${esc(m.slug)}">remove</button></td></tr>`).join("")}</tbody></table></div>`;
  $$("#view button[data-slug]").forEach(b => b.onclick = async () => {
    await api("/api/models/" + encodeURIComponent(b.dataset.slug), { method: "DELETE" });
    MODELS = (await api("/api/models")).models;
    toast("Removed from watchlist");
    viewModels();
  });
  $$("#view .note-inline").forEach(inp => inp.onchange = async () => {
    const slug = inp.dataset.slug, note = inp.value;
    try {
      try { await api("/api/models/" + encodeURIComponent(slug), { method: "DELETE" }); } catch (e) {}
      await api("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, note }) });
      toast("Note saved: " + slug);
    } catch (e) { toast(e.message, true); }
    MODELS = (await api("/api/models")).models;
    viewModels();
  });
  (async () => {
    try {
      const d = await api("/api/presets");
      $("#preset-box").innerHTML = d.presets.map(p =>
        `<button class="sm" data-preset="${esc(p.name)}" title="${esc(p.description)}">${esc(p.label)} <span style="color:var(--faint)">· ${p.models.length}</span></button>`).join("");
      $$("#preset-box button[data-preset]").forEach(b => b.onclick = async () => {
        try {
          const r = await api("/api/presets/" + encodeURIComponent(b.dataset.preset), { method: "POST" });
          MODELS = r.models;
          toast(`Preset "${b.dataset.preset}" applied (${r.models.length} models)`);
          viewModels();
        } catch (e) { toast(e.message, true); }
      });
    } catch (e) { $("#preset-box").innerHTML = '<span class="empty">presets unavailable</span>'; }
  })();
  const input = $("#model-search"), list = $("#model-ac");
  let deb;
  input.oninput = () => {
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const q = input.value.trim();
      if (q.length < 2) { list.classList.remove("show"); return; }
      const r = await api("/api/catalog?q=" + encodeURIComponent(q));
      list.innerHTML = r.results.map(m =>
        `<div class="ac-item" data-slug="${esc(m.id)}"><span class="n">${esc(m.id)}</span><div class="d">${esc(m.name || "")}</div></div>`).join("")
        || '<div class="ac-item faint">no match</div>';
      list.classList.add("show");
      $$(".ac-item", list).forEach(it => it.onclick = async () => {
        list.classList.remove("show");
        input.value = "";
        try {
          await api("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: it.dataset.slug }) });
          MODELS = (await api("/api/models")).models;
          toast("Added: " + it.dataset.slug);
          viewModels();
        } catch (e) { toast(e.message, true); }
      });
    }, 300);
  };
}

/* -------------------------------------------------------------- settings */

function viewSettings() {
  const s = STATE.settings;
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Engine behaviour. Applied live — no restart needed.</div></div></div>
    <div class="panel"><h2>Cost model</h2>
      <div class="hint" style="margin-bottom:6px">Blended $/M = in_f · input + cache_f · cache + out_f · output. Defaults from your measured month: 14 / 85 / 1.</div>
      ${mixControls("s")}
    </div>
    <div class="panel"><h2>Health gates</h2>
      <div class="row-ctl">
        <div><label class="field">Min throughput (tps)</label><input type="number" id="s-tps" value="${s.min_tps}"></div>
        <div><label class="field">Min uptime (%)</label><input type="number" id="s-up" value="${s.min_uptime}" step="0.1"></div>
        <div><label class="field">Check interval (min)</label><input type="number" id="s-int" value="${s.interval_min}"></div>
      </div></div>
    <div class="panel"><h2>Applying</h2>
      <label class="switch"><input type="checkbox" id="s-restart" ${s.gateway_restart ? "checked" : ""}> Restart gateway after switching (required for the new pin to take effect)</label>
      <div style="margin-top:14px"><button class="primary" id="btn-save">Save settings</button></div></div>`;
  ["in", "cache", "out"].forEach(k => $("#s-" + k).value = Math.round(STATE.settings.mix[k] * 100));
  $("#btn-save").onclick = async () => {
    try {
      const body = {
        mix: { in: +$("#s-in").value / 100, cache: +$("#s-cache").value / 100, out: +$("#s-out").value / 100 },
        min_tps: +$("#s-tps").value, min_uptime: +$("#s-up").value,
        interval_min: +$("#s-int").value, gateway_restart: $("#s-restart").checked,
      };
      const r = await api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      STATE.settings = r.settings;
      toast("Settings saved");
    } catch (e) { toast(e.message, true); }
  };
}

/* ---------------------------------------------------------------- events */

function viewEvents() {
  $("#view").innerHTML = `
    <div class="page-head"><div><h1>Events</h1><div class="sub">Engine decisions and switches.</div></div></div>
    <div class="panel"><div id="ev-list"><span class="spinner"></span></div></div>`;
  api("/api/events?limit=60").then(d => {
    $("#ev-list").innerHTML = d.events.length ? d.events.map(e => `
      <div class="ev-row"><span class="ts">${esc(e.ts)}</span>
        <span class="badge ${e.event === "switch" ? "ok" : e.event === "engine_error" ? "bad" : "info"}">${esc(e.event)}</span>
        <span class="body">${esc(JSON.stringify({ ...e, ts: undefined, event: undefined }, null, 0).slice(1, -1))}</span>
      </div>`).join("") : '<div class="empty">No events yet.</div>';
  });
}

/* ---------------------------------------------------------------- router */

const VIEWS = { overview: viewOverview, ranking: viewRanking, catalog: viewCatalog, chains: viewChains, providers: viewProviders, api: viewApi, chat: viewChat, models: viewModels, settings: viewSettings, events: viewEvents };

function route() {
  const name = (location.hash.replace("#/", "") || "overview");
  const view = VIEWS[name] ? name : "overview";
  $$("#nav .nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  VIEWS[view]();
}

async function loadCommon() {
  const [st, ch, md] = await Promise.all([api("/api/state"), api("/api/chains"), api("/api/models")]);
  STATE = st; CHAINS = ch.chains; MODELS = md.models;
  RANKED = (await api("/api/rank")).models;
  renderRoutingNow();
  route();
}

window.addEventListener("hashchange", route);
window.addEventListener("load", async () => {
  buildNav();
  try {
    await loadCommon();
  } catch (e) {
    $("#view").innerHTML = `<div class="panel"><h2>Backend offline</h2><div class="muted">${esc(e.message)}</div></div>`;
  }
  setInterval(async () => {
    try { STATE = await api("/api/state"); renderRoutingNow(); } catch (e) {}
  }, 30000);
});
