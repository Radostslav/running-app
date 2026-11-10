"use strict";
/* =========================================================
   TRImates – intervalový trenér pro běh a kolo
   Soubory: index.html (struktura) · styles.css (vzhled) · app.js (logika)
   ========================================================= */

// ---------- konfigurace ----------
const CFG = {
  repo: "Radostslav/running-app",
  branch: "main",
  dir: "treninky",
  history: "vysledky/historie.json",
};
const SPORTS = {
  beh: { key: "beh", label: "Běh", garmin: "running", metric: "pace", minDist: 50, maxSpeed: 12, kmSec: 360,
         names: { warmup: "Rozklus", interval: "Interval", recovery: "Meziklus", cooldown: "Výklus" } },
  kolo: { key: "kolo", label: "Kolo", garmin: "cycling", metric: "speed", minDist: 100, maxSpeed: 25, kmSec: 120,
          names: { warmup: "Rozjetí", interval: "Interval", recovery: "Volně", cooldown: "Vyjetí" } },
};
const DEFAULT_TYPES = ["Intervaly", "Tempo", "Vytrvalost"];
const PHASE_COLOR = { warmup: "#8DBFFF", interval: "#FF6B2C", recovery: "#5FD896", cooldown: "#8DBFFF", paused: "#C8CCD1" };

// ---------- pomocné ----------
const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign({ voice: true, countdown: true, beep: true }, store.get("settings", {}));
const fmt = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const kmNum = m => (m / 1000).toFixed(m % 1000 === 0 ? 0 : m >= 10000 ? 1 : 2).replace(".", ",");
const km = m => kmNum(m) + " km";
const durLabel = sec => sec % 60 === 0 ? sec / 60 + " min" : fmt(sec);
const dShort = t => new Date(t).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
const dLong = t => new Date(t).toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "trenink";
const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;
/** „TRImates 4x (3-2-1 min) 13.10.2026“ → „4x (3-2-1 min)“ */
const cleanTitle = n => (n || "").replace(/^TRImates\s*/i, "").replace(/\s+\d{1,2}\.\s?\d{1,2}\.\s?\d{4}$/, "").trim() || n || "Trénink";
const nameDate = n => { const m = (n || "").match(/(\d{1,2})\.\s?(\d{1,2})\.\s?\d{4}$/); return m ? `${m[1]}. ${m[2]}.` : ""; };
/** „3:00“, „3“, „0:45“ → sekundy */
const parseTime = v => {
  v = String(v || "").trim().replace(",", ".");
  if (!v) return 0;
  if (v.includes(":")) { const [m, s] = v.split(":"); return Math.round((Number(m) || 0) * 60 + (Number(s) || 0)); }
  return Math.round((Number(v) || 0) * 60);
};
const distTxt = m => m < 1000 ? Math.round(m) + " m" : km(m);
const distSpoken = m => m < 1000 ? Math.round(m) + " metrů" : km(m);
const spokenTime = sec => {
  sec = Math.round(sec); const m = Math.floor(sec / 60), s = sec % 60, out = [];
  if (m) out.push(m + " " + plural(m, "minuta", "minuty", "minut"));
  if (s || !m) out.push(s + " " + plural(s, "sekunda", "sekundy", "sekund"));
  return out.join(" ");
};
/** Cíl z editoru → rychlost v m/s (běh: tempo min/km, kolo: km/h) */
const targetToSpeed = (v, sport) => {
  v = String(v || "").trim(); if (!v) return null;
  if (SPORTS[sport].metric === "speed") { const k = parseFloat(v.replace(",", ".")); return k > 0 ? k / 3.6 : null; }
  const sec = parseTime(v); return sec > 0 ? 1000 / sec : null;
};
const targetTxt = (speed, sport) => SPORTS[sport].metric === "speed" ? (speed * 3.6).toFixed(1).replace(".", ",") + " km/h" : fmt(1000 / speed) + " /km";
const isWalk = s => /chůz|chuz|walk/i.test(s.name);
const estSec = (s, sport = "beh") => {
  if (s.kind === "time") return s.seconds;
  if (s.kind === "open") return s.type === "cooldown" ? 300 : 360;
  if (s.target) return s.meters / s.target;
  return s.meters / 1000 * (isWalk(s) ? 660 : SPORTS[sport].kmSec);
};
const ICON_CHEV = '<svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true"><path d="M1.5 1.5 7 7l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_INFO = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 8v5M9 5.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** Výkon úseku: tempo (s/km) pro běh, rychlost (km/h) pro kolo */
function metric(sec, m, sport) {
  const S = SPORTS[sport] || SPORTS.beh;
  if (!sec || m < S.minDist) return null;
  return S.metric === "speed" ? m / sec * 3.6 : sec / (m / 1000);
}
function metricTxt(v, sport, unit = true) {
  if (v == null) return "—";
  return SPORTS[sport].metric === "speed" ? v.toFixed(1).replace(".", ",") + (unit ? " km/h" : "") : fmt(v) + (unit ? " /km" : "");
}

// =========================================================
// GitHub
// =========================================================
const b64enc = s => { const b = new TextEncoder().encode(s); let r = ""; for (let i = 0; i < b.length; i += 8192) r += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return btoa(r); };
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, "")), c => c.charCodeAt(0)));
const gh = {
  token: () => store.get("ghToken", ""),
  path: p => p.split("/").map(encodeURIComponent).join("/"),
  async req(url, opt = {}) {
    const h = { Accept: "application/vnd.github+json" };
    const t = gh.token();
    if (t) h.Authorization = "Bearer " + t;
    if (opt.body) h["Content-Type"] = "application/json";
    return fetch("https://api.github.com" + url, { ...opt, headers: h, cache: "no-store" });
  },
  fail(r) { const e = new Error("GitHub " + r.status); e.status = r.status; return e; },
  async tree() {
    const r = await gh.req(`/repos/${CFG.repo}/git/trees/${CFG.branch}?recursive=1`);
    if (!r.ok) throw gh.fail(r);
    return (await r.json()).tree;
  },
  async raw(path) {
    const r = await fetch(`https://raw.githubusercontent.com/${CFG.repo}/${CFG.branch}/${gh.path(path)}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw gh.fail(r);
    return r.text();
  },
  async get(path) {
    const r = await gh.req(`/repos/${CFG.repo}/contents/${gh.path(path)}?ref=${CFG.branch}`);
    if (r.status === 404) return null;
    if (!r.ok) throw gh.fail(r);
    const j = await r.json();
    return { sha: j.sha, text: b64dec(j.content) };
  },
  async put(path, text, sha, message) {
    const r = await gh.req(`/repos/${CFG.repo}/contents/${gh.path(path)}`, {
      method: "PUT", body: JSON.stringify({ message, content: b64enc(text), branch: CFG.branch, ...(sha ? { sha } : {}) }),
    });
    if (!r.ok) throw gh.fail(r);
    return (await r.json()).content.sha;
  },
  async del(path, sha, message) {
    const r = await gh.req(`/repos/${CFG.repo}/contents/${gh.path(path)}`, {
      method: "DELETE", body: JSON.stringify({ message, sha, branch: CFG.branch }),
    });
    if (!r.ok) throw gh.fail(r);
  },
  async check() {
    const r = await gh.req(`/repos/${CFG.repo}`);
    if (!r.ok) throw gh.fail(r);
    const j = await r.json();
    return !!(j.permissions && j.permissions.push);
  },
};

// =========================================================
// Převod tréninku z Garmin Connect
// =========================================================
function sportFromGarmin(obj) {
  const k = (obj.sportType && obj.sportType.sportTypeKey) || "";
  return /cycl|bik/i.test(k) ? "kolo" : "beh";
}
function parseJson(obj, sportHint) {
  const sport = SPORTS[sportHint] ? sportHint : sportFromGarmin(obj);
  const fb = SPORTS[sport].names;
  const out = [];
  let maxS = 0, block = 0;
  function mk(s, series) {
    const key = (s.stepType && s.stepType.stepTypeKey) || "", cond = (s.endCondition && s.endCondition.conditionTypeKey) || "";
    const type = ["warmup", "interval", "recovery", "cooldown"].includes(key) ? key : key === "rest" ? "recovery" : "interval";
    const raw = (s.description || "").trim(), v = Number(s.endConditionValue) || 0;
    let name = raw ? raw[0].toUpperCase() + raw.slice(1) : fb[type];
    // cíl z Garminu: pace.zone / speed.zone v m/s
    const tk = (s.targetType && s.targetType.workoutTargetTypeKey) || "";
    const t1 = Number(s.targetValueOne) || 0, t2 = Number(s.targetValueTwo) || 0;
    const target = /pace|speed/.test(tk) && (t1 || t2) ? (t1 && t2 ? (t1 + t2) / 2 : t1 || t2) : null;
    if (cond === "time") { if (!raw && type === "interval") name = "Interval " + durLabel(v); return { name, type, series, kind: "time", seconds: v, target }; }
    if (cond === "distance") { if (!raw && type === "interval") name = "Interval " + distTxt(v || 1000); return { name, type, series, kind: "distance", meters: v || 1000, target }; }
    // „do stisku tlačítka“: hodnotu od 500 m ber jako vzdálenost, jinak úsek ukončíš sám
    if (cond === "lap.button") return v >= 500 ? { name, type, series, kind: "distance", meters: v } : { name, type, series, kind: "open" };
    return null;
  }
  // každý blok opakování má vlastní číslování (1 z 6), série jsou ale v celém tréninku jedinečné
  function visit(steps, series, meta) {
    (steps || []).forEach(s => {
      if (s.type === "RepeatGroupDTO" || (s.stepType && s.stepType.stepTypeKey === "repeat")) {
        const reps = Math.max(1, Number(s.numberOfIterations || s.endConditionValue || 1));
        const top = !series, base = maxS;
        if (top) { block++; maxS += reps; }
        for (let r = 0; r < reps; r++) {
          const before = out.length;
          visit(s.workoutSteps, top ? base + r + 1 : series, top ? { rep: r + 1, repCount: reps, block } : meta);
          if (r === reps - 1 && s.skipLastRestStep && out.length > before && out[out.length - 1].type === "recovery") out.pop();
        }
        return;
      }
      const st = mk(s, series);
      if (st && (st.kind !== "time" || st.seconds > 0)) out.push(meta ? Object.assign(st, meta) : st);
    });
  }
  (obj.workoutSegments || []).forEach(seg => visit(seg.workoutSteps, 0, null));
  if (!out.length) throw new Error("v souboru nejsou kroky tréninku");
  if (!maxS) maxS = inferSeries(out);
  // na pocit se ptáme jen po sériích s více intervaly (ne po každé opakované dvoustovce)
  const lastInt = {}, perSeries = {};
  out.forEach((s, i) => { if (s.series && s.type === "interval") { lastInt[s.series] = i; perSeries[s.series] = (perSeries[s.series] || 0) + 1; } });
  Object.keys(lastInt).forEach(k => { if (perSeries[k] > 1) out[lastInt[k]].seriesEnd = true; });
  // „série“ s jediným intervalem jsou ve skutečnosti opakování (např. 8× 200 m)
  const singleRep = maxS > 0 && Object.values(perSeries).every(n => n <= 1);
  return { name: obj.workoutName || "Trénink", sport, steps: out, seriesCount: maxS, singleRep };
}
/** Trénink zapsaný bez opakování (např. 2× 8-4-2-1) – série se poznají podle opakujícího se vzoru */
function inferSeries(out) {
  const ints = out.map((s, i) => s.type === "interval" && s.kind !== "open" ? i : -1).filter(i => i >= 0);
  const d = ints.map(i => out[i].kind + (out[i].seconds || out[i].meters));
  for (let p = 2; p <= d.length / 2; p++) {
    if (d.length % p || !d.every((x, k) => x === d[k % p])) continue;
    const reps = d.length / p;
    for (let r = 0; r < reps; r++) {
      const from = ints[r * p], to = r < reps - 1 ? ints[(r + 1) * p] - 1 : ints[ints.length - 1];
      for (let i = from; i <= to; i++) Object.assign(out[i], { series: r + 1, rep: r + 1, repCount: reps, block: 1 });
    }
    return reps;
  }
  return 0;
}
/** Odstraní z Garmin JSONu osobní údaje autora */
function cleanGarmin(obj) {
  const o = JSON.parse(JSON.stringify(obj));
  ["author", "ownerId", "sharedWithUsers", "workoutId", "trainingPlanId", "workoutThumbnailUrl", "uploadTimestamp", "consumer", "consumerName", "consumerImageURL", "consumerWebsiteURL"].forEach(k => { if (k in o) o[k] = null; });
  return o;
}

// =========================================================
// Knihovna tréninků (složka treninky/<sport>/<typ>/*.json)
// =========================================================
let library = store.get("library4", []);
let libState = library.length ? "cached" : "loading", lastLoad = 0;

function fromFile(path, sha, obj) {
  const parts = path.split("/");
  const sportDir = SPORTS[parts[1]] ? parts[1] : null;
  const w = parseJson(obj, sportDir);
  const type = parts.length >= 4 ? parts[2] : "Intervaly";
  return { path, sha, sport: w.sport, type, name: w.name, steps: w.steps, seriesCount: w.seriesCount, singleRep: w.singleRep };
}
async function loadLibrary(force) {
  if (!force && Date.now() - lastLoad < 20000) return;
  try {
    const tree = await gh.tree();
    const files = tree.filter(t => t.type === "blob" && t.path.startsWith(CFG.dir + "/") && /\.json$/i.test(t.path));
    const old = new Map(library.map(w => [w.path + "@" + w.sha, w]));
    const list = await Promise.all(files.map(async f => {
      const hit = old.get(f.path + "@" + f.sha);
      if (hit) return hit;
      try { return fromFile(f.path, f.sha, JSON.parse(await gh.raw(f.path))); } catch (e) { return null; }
    }));
    library = list.filter(Boolean);
    store.set("library4", library);
    lastLoad = Date.now();
    libState = "ok";
  } catch (e) {
    libState = library.length ? "offline" : "error";
  }
  refresh();
}
const repWord = (n, single) => single ? "opakování" : plural(n, "série", "série", "sérií");
const workoutsOf = sport => library.filter(w => w.sport === sport);
function typesOf(sport) {
  const used = [...new Set(workoutsOf(sport).map(w => w.type))];
  return [...DEFAULT_TYPES, ...used.filter(t => !DEFAULT_TYPES.includes(t)).sort((a, b) => a.localeCompare(b, "cs"))];
}
function workoutMeta(w) {
  const total = w.steps.reduce((a, s) => a + estSec(s, w.sport), 0);
  return "≈ " + Math.round(total / 60) + " min" + (w.seriesCount ? " · " + w.seriesCount + " " + repWord(w.seriesCount, w.singleRep) : "");
}
function buildStrip(el, steps, sport) {
  el.innerHTML = "";
  steps.forEach(s => { const i = document.createElement("i"); i.dataset.type = s.type; i.style.flexGrow = estSec(s, sport); el.appendChild(i); });
}

// =========================================================
// Navigace mezi obrazovkami
// =========================================================
let nav = [{ screen: "home" }];
const curNav = () => nav[nav.length - 1];

function go(screen, params = {}, replace = false) {
  const entry = { screen, ...params };
  if (replace) nav[nav.length - 1] = entry;
  else { nav.push(entry); history.pushState({ n: nav.length }, ""); }
  closeMenu();
  show();
  scrollTo(0, 0);
}
function back() {
  if (nav.length > 1) history.back();
}
addEventListener("popstate", () => {
  if (runActive()) { history.pushState({ n: nav.length }, ""); return; }
  if (nav.length > 1) { nav.pop(); closeMenu(); hideRpe(); show(); }
});
function show() {
  const n = curNav();
  document.body.dataset.screen = n.screen;
  document.querySelectorAll("section.screen").forEach(s => { s.hidden = s.dataset.screen !== n.screen; });
  const showBack = nav.length > 1 && !(n.screen === "summary" && n.fresh);
  $("backBtn").classList.toggle("ghost", !showBack);
  $("appbarTitle").textContent = n.screen === "detail" ? (SPORTS[n.sport] || {}).label || "" : "";
  if (!runActive()) { document.body.dataset.state = ""; document.body.dataset.phase = ""; lastPhase = ""; setTheme(null); }
  refresh();
}
function refresh() {
  const n = curNav();
  ({ home: renderHome, list: renderList, detail: renderDetail, summary: renderSummary,
     history: renderHistory, manage: renderManage, editor: renderEditor, settings: renderSettings, run: render }[n.screen] || (() => {}))();
}
function setTheme(c) { $("themeColor").content = c || (matchMedia("(prefers-color-scheme: dark)").matches ? "#0E1012" : "#F3F4F2"); }

// ---------- menu ----------
function openMenu() { $("menuSheet").hidden = false; $("menuScrim").hidden = false; }
function closeMenu() { $("menuSheet").hidden = true; $("menuScrim").hidden = true; }
$("menuBtn").addEventListener("click", openMenu);
$("menuScrim").addEventListener("click", closeMenu);
$("backBtn").addEventListener("click", back);
document.querySelectorAll("#menuSheet [data-go]").forEach(b => b.addEventListener("click", () => {
  const [screen, sport] = b.dataset.go.split(":");
  if (screen === "list") { store.set("lastSport", sport); nav = [{ screen: "home" }]; go("list", { sport }); }
  else go(screen);
}));

// =========================================================
// Obrazovka: rozcestník
// =========================================================
function renderHome() {
  ["beh", "kolo"].forEach(sp => {
    const n = workoutsOf(sp).length;
    const last = hist.find(r => r.sport === sp);
    const el = $(sp === "beh" ? "metaBeh" : "metaKolo");
    el.textContent = libState === "loading" && !n ? "Načítám tréninky…"
      : (n ? n + " " + plural(n, "trénink", "tréninky", "tréninků") : "Zatím žádné tréninky") + (last ? " · naposledy " + dShort(last.date) : "");
  });
  $("homeStatus").textContent = libState === "offline" ? "Bez připojení, zobrazuji naposledy stažené tréninky"
    : libState === "error" ? "Tréninky se nepodařilo načíst. Zkontroluj připojení k internetu." : "";
}
document.querySelectorAll(".tile").forEach(t => t.addEventListener("click", () => {
  store.set("lastSport", t.dataset.sport);
  go("list", { sport: t.dataset.sport });
}));

// =========================================================
// Obrazovka: seznam tréninků podle typu
// =========================================================
function workoutCard(w) {
  const b = document.createElement("button");
  b.className = "wcard";
  b.innerHTML = `<span class="wmain"><b></b><span class="meta"></span><span class="strip mini" aria-hidden="true"></span></span>${ICON_CHEV}`;
  b.querySelector("b").textContent = cleanTitle(w.name);
  b.querySelector(".meta").textContent = workoutMeta(w) + (nameDate(w.name) ? " · " + nameDate(w.name) : "");
  buildStrip(b.querySelector(".strip"), w.steps, w.sport);
  b.addEventListener("click", () => go("detail", { sport: w.sport, path: w.path }));
  return b;
}
function renderList() {
  const sport = curNav().sport;
  $("listTitle").textContent = SPORTS[sport].label;
  const body = $("listBody");
  body.innerHTML = "";
  const all = workoutsOf(sport);
  if (!all.length) {
    body.innerHTML = `<div class="empty"><p>${libState === "loading" ? "Načítám tréninky…" : "Zatím tu nejsou žádné tréninky"}</p></div>`;
    if (libState !== "loading") {
      const b = document.createElement("button");
      b.className = "btn btn-secondary"; b.textContent = "Přidat trénink";
      b.addEventListener("click", () => addWorkout(sport));
      body.firstChild.appendChild(b);
    }
    return;
  }
  typesOf(sport).forEach(type => {
    const list = all.filter(w => w.type === type).sort((a, b) => cleanTitle(a.name).localeCompare(cleanTitle(b.name), "cs"));
    if (!list.length) return;
    const g = document.createElement("section");
    g.className = "group";
    g.innerHTML = `<h2>${esc(type)}</h2><div class="wlist"></div>`;
    list.forEach(w => g.querySelector(".wlist").appendChild(workoutCard(w)));
    body.appendChild(g);
  });
  const add = document.createElement("button");
  add.className = "btn btn-secondary add-more";
  add.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>Přidat trénink';
  add.addEventListener("click", () => addWorkout(sport));
  body.appendChild(add);
}
/** S připojeným GitHubem rovnou editor, jinak správa tréninků s výzvou k připojení */
function addWorkout(sport) {
  if (gh.token()) go("editor", { draft: newDraft(sport) });
  else go("manage", { sport });
}

// =========================================================
// Obrazovka: detail tréninku
// =========================================================
let detailW = null;
function renderDetail() {
  const n = curNav();
  detailW = library.find(w => w.path === n.path);
  if (!detailW) { $("rName").textContent = "Trénink nenalezen"; $("startBtn").hidden = true; return; }
  $("startBtn").hidden = false;
  const w = detailW, sp = SPORTS[w.sport];
  $("rKicker").textContent = nameDate(w.name) ? "Trénink " + nameDate(w.name) : w.type;
  $("rName").textContent = cleanTitle(w.name);
  // kolo: venku nebo na trenažéru
  const indoor = w.sport === "kolo" && store.get("bikeEnv", "out") === "in";
  $("envSeg").hidden = w.sport !== "kolo";
  $("envSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String((b.dataset.env === "in") === indoor)));
  const total = w.steps.reduce((a, s) => a + estSec(s, w.sport), 0);
  const dist = w.steps.reduce((a, s) => a + (s.kind === "distance" ? s.meters : 0), 0);
  const f = [["≈ " + Math.round(total / 60), "minut"]];
  if (w.seriesCount) f.push([w.seriesCount, repWord(w.seriesCount, w.singleRep)]);
  if (dist && !indoor) {
    const t = new Set(w.steps.filter(s => s.kind === "distance").map(s => s.type));
    f.push([kmNum(dist), "km " + (t.has("warmup") && t.has("cooldown") ? sp.names.warmup.toLowerCase() + " a " + sp.names.cooldown.toLowerCase() : t.has("warmup") ? sp.names.warmup.toLowerCase() : t.has("cooldown") ? sp.names.cooldown.toLowerCase() : "na vzdálenost")]);
  }
  $("rFacts").innerHTML = f.map(([a, b]) => `<div class="fact"><b class="num">${esc(a)}</b><span>${esc(b)}</span></div>`).join("");
  buildStrip($("rStrip"), w.steps, w.sport);
  $("rLegend").innerHTML = `<span class="l1">${sp.names.warmup} a ${sp.names.cooldown.toLowerCase()}</span><span class="l2">Interval</span><span class="l3">${sp.names.recovery === "Volně" ? "Volně" : "Meziklus"}</span>`;
  const pl = $("planList");
  pl.innerHTML = "";
  let lastS = -1;
  w.steps.forEach(s => {
    if (s.series && s.series !== lastS) pl.insertAdjacentHTML("beforeend", `<li class="sh">${s.rep || s.series}. ${w.singleRep ? "opakování" : "série"}</li>`);
    if (!s.series && lastS > 0) pl.insertAdjacentHTML("beforeend", `<li class="sh">Závěr</li>`);
    lastS = s.series || 0;
    const kind = indoor && s.kind === "distance" ? "open" : s.kind;
    const v = (kind === "distance" ? distTxt(s.meters) : kind === "open" ? "volně" : fmt(s.seconds)) + (s.target && !indoor ? " · " + targetTxt(s.target, w.sport) : "");
    pl.insertAdjacentHTML("beforeend", `<li data-type="${s.type}"><span>${esc(s.name)}</span><span class="v num">${esc(v)}</span></li>`);
  });
  $("planCount").textContent = w.steps.length + " " + plural(w.steps.length, "krok", "kroky", "kroků");
  const hints = indoor
    ? ["Na trenažéru se poloha neměří, úseky na vzdálenost ukončíš tlačítkem"]
    : ["Při startu povol polohu, měří se z ní " + (w.sport === "kolo" ? "rychlost" : "tempo") + " úseků",
       "Displej nech zapnutý, po zamčení iPhone ztlumí hlas i GPS"];
  $("rHints").innerHTML = hints.map(t => `<li>${ICON_INFO}<span>${esc(t)}</span></li>`).join("");
}
$("envSeg").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  store.set("bikeEnv", b.dataset.env);
  renderDetail();
});
$("startBtn").addEventListener("click", () => { if (detailW) startWorkout(detailW); });

// =========================================================
// Zvuk, hlas, displej
// =========================================================
function say(t, force) {
  if (!settings.voice && !force) return;
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "cs-CZ"; u.rate = .93;
  const v = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith("cs"));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
let actx = null;
function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {} }
function beep(f = 880, d = .12, v = .3) {
  if (!actx || !settings.beep) return;
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = f;
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + d + .03);
}
let wakeLock = null;
async function getWakeLock() { try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (e) {} }
function releaseWakeLock() { if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; } }

// =========================================================
// Průběh tréninku
// Čas se počítá z reálných hodin, takže po uspání stránky se dorovná.
// =========================================================
let runState = "idle"; // idle | running | paused
let workout = [], ctx = null;
let idx = 0, ticker = null, stepEndsAt = 0, pausedRemaining = 0, elapsedMs = 0, resumedAt = 0, stepStartElapsed = 0;
let flags = {}, results = [], rpe = {}, pendingRpe = null, skippedNote = "";
let gpsWatch = null, gpsState = "", lastPt = null, stepDist = 0, stepFixes = 0, stepMaxGap = 0, lastFixT = 0;
const cur = () => workout[idx];
const runActive = () => runState === "running" || runState === "paused";
const elapsedNow = () => elapsedMs + (runState === "running" ? Date.now() - resumedAt : 0);
function remainingMs() {
  const s = cur();
  if (!s || s.kind !== "time") return 0;
  if (runState === "paused") return pausedRemaining;
  return Math.max(0, stepEndsAt - Date.now());
}
function spoken(s) {
  const t = s.target ? ", cíl " + (SPORTS[ctx.sport].metric === "speed" ? (s.target * 3.6).toFixed(0) + " kilometrů za hodinu" : spokenTime(1000 / s.target) + " na kilometr") : "";
  if (s.kind === "distance") return s.name + (/\d/.test(s.name) ? "" : ". " + distSpoken(s.meters)) + t;
  return s.name + (s.kind === "open" ? ". Až budeš hotový, ťukni na Úsek hotový" : "") + t;
}
function enterStep(i, startAt) {
  idx = i; flags = { beeped: {} };
  stepStartElapsed = elapsedNow() - (Date.now() - startAt);
  stepDist = 0; stepFixes = 0; stepMaxGap = 0; lastFixT = startAt;
  const s = cur();
  if (s.kind === "time") stepEndsAt = startAt + s.seconds * 1000;
  if (s.type === "interval") { hideRpe(); feedback = ""; }
  const c = $("clock"); c.classList.remove("tick"); void c.offsetWidth; c.classList.add("tick");
}
let feedback = "", feedbackSpoken = "";
/** Porovná úsek s cílem: u vzdálenosti čas úseku, u času tempo / rychlost */
function evalTarget(s, sec, m, ok) {
  if (!s.target || !ok || s.kind === "open") return null;
  const sp = SPORTS[ctx.sport];
  if (s.kind === "distance") {
    const tgt = s.meters / s.target, dev = sec - tgt, tol = Math.max(1, tgt * .02), d = Math.round(Math.abs(dev));
    const verdict = Math.abs(dev) <= tol ? "v cíli" : dev < 0 ? `o ${d} s rychleji` : `o ${d} s pomaleji`;
    const said = Math.abs(dev) <= tol ? "přesně v cíli" : dev < 0 ? `o ${spokenTime(d)} rychleji` : `o ${spokenTime(d)} pomaleji`;
    return { dev, txt: `Úsek za ${fmt(sec)}, cíl ${fmt(tgt)} · ${verdict}`, spoken: `Čas ${spokenTime(sec)}, ${said}` };
  }
  const v = metric(sec, m, ctx.sport);
  if (v == null) return null;
  if (sp.metric === "speed") {
    const tgt = s.target * 3.6, dev = v - tgt, d = Math.abs(dev).toFixed(1).replace(".", ",");
    const verdict = Math.abs(dev) <= .5 ? "v cíli" : dev > 0 ? `o ${d} km/h rychleji` : `o ${d} km/h pomaleji`;
    return { dev, txt: `${metricTxt(v, ctx.sport)}, cíl ${targetTxt(s.target, ctx.sport)} · ${verdict}`, spoken: "Rychlost " + Math.round(v) + " kilometrů za hodinu, " + (Math.abs(dev) <= .5 ? "přesně v cíli" : verdict.replace("km/h", "kilometrů za hodinu")) };
  }
  const tgt = 1000 / s.target, dev = v - tgt, d = Math.round(Math.abs(dev));
  const verdict = Math.abs(dev) <= 3 ? "v cíli" : dev < 0 ? `o ${d} s/km rychleji` : `o ${d} s/km pomaleji`;
  return { dev, txt: `Tempo ${fmt(v)}, cíl ${fmt(tgt)} · ${verdict}`, spoken: "Tempo " + spokenTime(v) + ", " + (Math.abs(dev) <= 3 ? "přesně v cíli" : verdict.replace("s/km", "sekund na kilometr")) };
}
function leaveStep(natural, endT) {
  const s = cur();
  const sec = natural && s.kind === "time" ? s.seconds : (elapsedNow() - (Date.now() - endT) - stepStartElapsed) / 1000;
  const gapEnd = Math.max(stepMaxGap, endT - lastFixT);
  const ok = !ctx.indoor && stepFixes >= 3 && gapEnd <= 15000;
  const ev = s.type === "interval" ? evalTarget(s, sec, stepDist, ok) : null;
  if (ev) { feedback = ev.txt; feedbackSpoken = ev.spoken; }
  results.push({ name: s.name, type: s.type, series: s.series || 0, plan: s.kind === "time" ? s.seconds : null,
                 planM: s.kind === "distance" ? s.meters : null, block: s.block || (s.series ? 1 : 0), rep: s.rep || s.series || 0, target: s.target || null, dev: ev ? ev.dev : null,
                 sec: Math.round(sec), m: Math.round(stepDist), ok });
  if (s.seriesEnd) pendingRpe = s.series;
}
function goNext(endT, natural) {
  leaveStep(natural, endT);
  if (idx >= workout.length - 1) { finishWorkout(false); return false; }
  enterStep(idx + 1, endT);
  return true;
}
function announceStep() {
  skippedNote = "";
  if (navigator.vibrate) navigator.vibrate([180, 100, 180]);
  beep(1320, .4);
  say((feedbackSpoken ? feedbackSpoken + ". " : "") + spoken(cur()) + (pendingRpe ? ". Ohodnoť sérii." : "."));
  feedbackSpoken = "";
  if (pendingRpe) { showRpe(pendingRpe); pendingRpe = null; }
}
function startWorkout(w) {
  if (runActive()) return;
  unlockAudio();
  clearTimeout(toastT); $("toast").hidden = true;
  const indoor = w.sport === "kolo" && store.get("bikeEnv", "out") === "in";
  ctx = { sport: w.sport, indoor, path: w.path, name: cleanTitle(w.name), seriesCount: w.seriesCount, singleRep: !!w.singleRep };
  workout = w.steps.map(s => indoor && s.kind === "distance" ? { ...s, kind: "open" } : { ...s });
  results = []; rpe = {}; pendingRpe = null; feedback = ""; feedbackSpoken = ""; elapsedMs = 0; idx = 0; skippedNote = ""; resumedAt = Date.now();
  runState = "running";
  enterStep(0, resumedAt);
  document.body.dataset.state = "running";
  buildStrip($("runStrip"), workout, ctx.sport);
  go("run");
  getWakeLock();
  if (!indoor) startGps(); else gpsState = "off";
  say("Trénink začíná. " + spoken(cur()) + ".");
  ticker = setInterval(tick, 200);
}
function tick() {
  if (runState !== "running") return;
  const now = Date.now();
  let s = cur(), skipped = 0;
  while (s.kind === "time" && now >= stepEndsAt) {
    if (!goNext(stepEndsAt, true)) return;
    skipped++; s = cur();
  }
  if (skipped) { announceStep(); skippedNote = skipped > 1 ? "Na pozadí uběhlo " + skipped + " úseků" : ""; }
  if (s.kind === "time") {
    const rem = (stepEndsAt - now) / 1000;
    if (settings.countdown && !flags.said10 && s.seconds > 15 && rem <= 10.3 && rem > 8) {
      flags.said10 = true;
      say("Za deset sekund " + (workout[idx + 1] ? workout[idx + 1].name : "konec tréninku"));
    }
    for (const n of [3, 2, 1]) if (!flags.beeped[n] && rem <= n && rem > n - .6) { flags.beeped[n] = true; beep(880, .12); }
  }
  render();
}
function pause() {
  pausedRemaining = remainingMs(); elapsedMs = elapsedNow();
  runState = "paused"; document.body.dataset.state = "paused";
  clearInterval(ticker); ticker = null; stopGps(); releaseWakeLock();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  render();
}
function resume() {
  unlockAudio(); resumedAt = Date.now();
  if (cur().kind === "time") stepEndsAt = resumedAt + pausedRemaining;
  lastFixT = Date.now();
  runState = "running"; document.body.dataset.state = "running";
  if (!ctx.indoor) startGps();
  getWakeLock();
  say("Pokračujeme. " + cur().name);
  ticker = setInterval(tick, 200);
  render();
}
function nextManual() { if (runState === "running" && goNext(Date.now(), false)) { announceStep(); render(); } }
function stopWorkout() {
  if (runState === "running") elapsedMs = elapsedNow();
  runState = "paused";
  if (results.length || elapsedMs > 20000) { leaveStep(false, Date.now()); finishWorkout(true); }
  else {
    clearInterval(ticker); ticker = null; stopGps(); releaseWakeLock(); hideRpe();
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    runState = "idle";
    back();
  }
}
function finishWorkout(partial) {
  if (runState === "running") elapsedMs = elapsedNow();
  clearInterval(ticker); ticker = null; stopGps(); releaseWakeLock();
  runState = "idle";
  if (!partial) { beep(1320, .2); setTimeout(() => beep(1760, .4), 250); say("Trénink dokončen. Skvělá práce!"); }
  else if ("speechSynthesis" in window) speechSynthesis.cancel();
  const now = Date.now();
  const rec = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6), date: now, updated: now,
    sport: ctx.sport, indoor: ctx.indoor, singleRep: ctx.singleRep, workout: ctx.path, name: ctx.name,
    total: Math.round(elapsedMs / 1000), dist: results.reduce((a, r) => a + (r.ok ? r.m : 0), 0),
    partial, results, rpe,
  };
  hist.unshift(rec); saveHist(); scheduleSync();
  go("summary", { id: rec.id, fresh: true }, true);
  if (pendingRpe) { showRpe(pendingRpe); pendingRpe = null; }
}

// ---------- GPS ----------
function hav(a, b) { const R = 6371000, r = Math.PI / 180, dA = (b.la - a.la) * r, dO = (b.lo - a.lo) * r; const h = Math.sin(dA / 2) ** 2 + Math.cos(a.la * r) * Math.cos(b.la * r) * Math.sin(dO / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function startGps() {
  if (!("geolocation" in navigator)) { gpsState = "denied"; return; }
  stopGps(); lastPt = null; if (gpsState !== "denied") gpsState = "wait";
  gpsWatch = navigator.geolocation.watchPosition(onPos, onGpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function stopGps() { if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; } }
function onPos(p) {
  if (runState !== "running") return;
  const { latitude: la, longitude: lo, accuracy: acc } = p.coords, pt = { la, lo, t: Date.now() };
  stepMaxGap = Math.max(stepMaxGap, pt.t - lastFixT); lastFixT = pt.t; stepFixes++;
  if (acc > 35) { gpsState = "weak"; return; }
  gpsState = "ok";
  if (lastPt) {
    const d = hav(lastPt, pt), dt = (pt.t - lastPt.t) / 1000;
    if (d < Math.max(4, acc * .3)) return;                                   // šum na místě
    if (dt > 0 && d / dt > SPORTS[ctx.sport].maxSpeed) { lastPt = pt; return; } // nereálný skok
    const prev = stepDist, s = cur();
    stepDist += d;
    if (s.kind === "distance" && prev < s.meters && stepDist >= s.meters) {
      // dopočítá, kdy přesně byla vzdálenost dosažena (mezi dvěma body GPS)
      const endT = lastPt.t + (s.meters - prev) / d * (pt.t - lastPt.t), extra = stepDist - s.meters;
      lastPt = pt; stepDist = s.meters;
      if (goNext(endT, true)) { stepDist = extra; announceStep(); }
      render();
      return;
    }
  }
  lastPt = pt;
  render();
}
function onGpsErr(e) { gpsState = e.code === 1 ? "denied" : "weak"; render(); }

// ---------- vykreslení běžecké obrazovky ----------
let lastPhase = "";
function render() {
  if (!runActive() || !workout.length || curNav().screen !== "run") return;
  const s = cur(), phase = runState === "paused" ? "paused" : s.type, sp = SPORTS[ctx.sport];
  if (phase !== lastPhase) { document.body.dataset.phase = phase; setTheme(PHASE_COLOR[phase]); lastPhase = phase; }
  const phaseName = phase === "paused" ? "Pozastaveno" : sp.names[phase];
  $("phaseLabel").textContent = phaseName === s.name ? "\u00a0" : phaseName;
  $("stepName").textContent = s.name;
  $("seriesLabel").textContent = s.series ? `${ctx.singleRep ? "Opakování" : "Série"} ${s.rep || s.series} z ${s.repCount || ctx.seriesCount}` : idx === 0 ? "Začátek" : "Závěr";
  $("totalLabel").textContent = fmt(elapsedNow() / 1000);
  const c = $("clock"), stepSec = (elapsedNow() - stepStartElapsed) / 1000;
  let prog = 0;
  if (s.kind === "time") { const r = remainingMs(); c.textContent = fmt(Math.ceil(r / 1000)); prog = 1 - r / (s.seconds * 1000); }
  else if (s.kind === "open") { c.textContent = fmt(stepSec); }
  else if (s.type === "interval" || s.meters < 1000) {
    // krátký úsek: velké stopky, vzdálenost v řádku pod nimi
    c.textContent = fmt(stepSec);
    prog = stepDist / s.meters;
  }
  else {
    const live = stepDist > 0 || gpsState === "ok";
    c.innerHTML = esc(live ? (stepDist / 1000).toFixed(2).replace(".", ",") : kmNum(s.meters)) + "<small>km</small>";
    prog = stepDist / s.meters;
  }
  fitClock();
  prog = Math.min(1, Math.max(0, prog));
  $("stepBar").style.width = prog * 100 + "%";
  $("stepBar").parentElement.style.visibility = s.kind === "open" ? "hidden" : "";
  [...$("runStrip").children].forEach((el, i) => {
    el.classList.toggle("done", i < idx); el.classList.toggle("cur", i === idx);
    if (i === idx) el.style.setProperty("--p", prog * 100 + "%");
  });
  let live = "";
  if (ctx.indoor) live = "";
  else if (gpsState === "denied") live = s.kind !== "time" ? "Bez polohy, úsek ukonči tlačítkem" : "Bez polohy se " + (sp.metric === "speed" ? "rychlost" : "tempo") + " neměří";
  else if (gpsState === "wait") live = "Hledám GPS…";
  else if (gpsState === "weak" && stepDist < 80) live = "Slabý GPS signál";
  else if (stepDist >= sp.minDist && stepSec > 8) live = `${metricTxt(metric(stepSec, stepDist, ctx.sport), ctx.sport)} · ${Math.round(stepDist)} m`;
  if (s.kind === "distance" && (s.type === "interval" || s.meters < 1000) && !ctx.indoor && gpsState !== "denied" && gpsState !== "wait")
    live = `${Math.min(Math.round(stepDist), s.meters)} z ${distTxt(s.meters)}` + (s.target ? " · cíl " + fmt(s.meters / s.target) : "");
  else if (s.kind === "time" && s.type === "interval" && s.target && live) live += " · cíl " + targetTxt(s.target, ctx.sport);
  if (feedback && s.type !== "interval") live = feedback;
  if (skippedNote) live = skippedNote;
  if (runState === "paused") live = "Ťukni na ▶ a pokračuj";
  $("live").textContent = live;
  const n = workout[idx + 1];
  $("nextName").textContent = n ? n.name : "Cíl";
  $("nextVal").textContent = n ? (n.kind === "distance" ? distTxt(n.meters) : n.kind === "open" ? "volně" : fmt(n.seconds)) : "";
  $("upNext").querySelector(".lab").textContent = n ? "Další" : "Potom";
  $("icPause").style.display = runState === "paused" ? "none" : "";
  $("icPlay").style.display = runState === "paused" ? "" : "none";
  $("pauseBtn").setAttribute("aria-label", runState === "paused" ? "Pokračovat" : "Pauza");
  $("nextBtn").classList.toggle("gone", runState === "paused");
  $("nextLab").textContent = s.kind !== "time" ? "Úsek hotový" : "Další úsek";
}
// velké číslo se vždy vejde na šířku displeje
let fitKey = "";
function fitClock(force) {
  const c = $("clock"), key = c.textContent.length + "|" + c.innerHTML.includes("small") + "|" + innerWidth;
  if (key === fitKey && !force) return;
  fitKey = key;
  c.style.fontSize = "";
  const max = c.clientWidth, w = c.scrollWidth;
  if (w > max) c.style.fontSize = parseFloat(getComputedStyle(c).fontSize) * max / w * .97 + "px";
}
addEventListener("resize", () => fitClock(true));
if (document.fonts) document.fonts.ready.then(() => fitClock(true));

// ovládání při běhu
$("pauseBtn").addEventListener("click", () => { runState === "running" ? pause() : runState === "paused" && resume(); });
$("nextBtn").addEventListener("click", nextManual);
(() => { // konec jen podržením – aby se trénink neukončil omylem
  const b = $("stopBtn");
  let t = null;
  const cancel = () => { clearTimeout(t); t = null; b.classList.remove("holding"); };
  b.addEventListener("pointerdown", e => {
    e.preventDefault(); b.classList.add("holding");
    t = setTimeout(() => { cancel(); if (navigator.vibrate) navigator.vibrate(60); stopWorkout(); }, 900);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, () => {
    if (t) { cancel(); $("stopLab").textContent = "Drž déle"; setTimeout(() => { $("stopLab").textContent = "Podrž pro konec"; }, 1400); }
  }));
  b.addEventListener("contextmenu", e => e.preventDefault());
  b.addEventListener("keydown", e => { if (e.key === "Enter" && confirm("Ukončit trénink?")) stopWorkout(); });
})();

// ---------- hodnocení série ----------
const rpeHue = n => Math.round(140 - (n - 1) * (130 / 9));
let rpeFor = null;
function showRpe(series) {
  rpeFor = series;
  const st = workout.find(x => x.series === series) || {};
  $("rpeTitle").textContent = `Jak těžká byla ${st.rep || series}. série?`; $("rpeSheet").hidden = false; $("rpeScrim").hidden = false; }
function hideRpe() { $("rpeSheet").hidden = true; $("rpeScrim").hidden = true; rpeFor = null; }
for (let n = 1; n <= 10; n++) {
  const b = document.createElement("button");
  b.textContent = n; b.style.setProperty("--h", rpeHue(n));
  b.setAttribute("aria-label", "Pocit " + n + " z 10");
  b.addEventListener("click", () => {
    if (rpeFor != null) {
      rpe[rpeFor] = n;
      const n2 = curNav();
      if (n2.screen === "summary") {
        const r = hist.find(x => x.id === n2.id);
        if (r) { r.rpe = { ...r.rpe, [rpeFor]: n }; r.updated = Date.now(); saveHist(); scheduleSync(); }
      }
    }
    hideRpe();
    if (curNav().screen === "summary") renderSummary();
  });
  $("rpeGrid").appendChild(b);
}
$("rpeSkip").addEventListener("click", hideRpe);
$("rpeScrim").addEventListener("click", hideRpe);

// =========================================================
// Historie a synchronizace s GitHubem
// =========================================================
let hist = store.get("history", []).map(r => ({ sport: "beh", updated: r.date, ...r, id: String(r.id) }));
let deletedIds = new Set(store.get("deletedIds", []));
let sync = { state: gh.token() ? "idle" : "off", at: store.get("lastSync", 0) };
let syncTimer = null;
function saveHist() { store.set("history", hist); }
function scheduleSync() { clearTimeout(syncTimer); if (gh.token()) { sync.state = "pending"; syncTimer = setTimeout(syncHistory, 1500); } }

/** Sloučí historii v telefonu s vysledky/historie.json a uloží zpět – vše v jednom souboru */
async function syncHistory(retry = true) {
  if (!gh.token()) { sync.state = "off"; return; }
  if (!navigator.onLine) { sync.state = "pending"; refreshSync(); return; }
  sync.state = "busy"; refreshSync();
  try {
    const f = await gh.get(CFG.history);
    let remote = [];
    try { remote = f ? JSON.parse(f.text) : []; } catch (e) { remote = []; }
    const map = new Map();
    for (const r of [...remote, ...hist]) {
      const id = String(r.id);
      if (deletedIds.has(id)) continue;
      const o = map.get(id);
      if (!o || (r.updated || 0) > (o.updated || 0)) map.set(id, { ...r, id });
    }
    const merged = [...map.values()].sort((a, b) => b.date - a.date);
    const text = JSON.stringify(merged, null, 1) + "\n";
    if (!f || f.text !== text) await gh.put(CFG.history, text, f && f.sha, "Výsledky tréninků");
    hist = merged; saveHist();
    deletedIds.clear(); store.set("deletedIds", []);
    sync = { state: "ok", at: Date.now() }; store.set("lastSync", sync.at);
  } catch (e) {
    if (retry && (e.status === 409 || e.status === 422)) return syncHistory(false);
    sync.state = e.status === 401 || e.status === 403 ? "auth" : "pending";
  }
  refreshSync();
}
function syncText() {
  switch (sync.state) {
    case "off": return { cls: "", html: 'Uloženo jen v telefonu · <a href="#" data-link="settings">Připojit GitHub</a>' };
    case "busy": return { cls: "pending", html: "Ukládám na GitHub…" };
    case "pending": return { cls: "pending", html: "Čeká na odeslání na GitHub" };
    case "auth": return { cls: "pending", html: 'GitHub odmítl token · <a href="#" data-link="settings">Zkontrolovat</a>' };
    case "ok": return { cls: "ok", html: "Uloženo na GitHubu" };
    default: return { cls: "", html: sync.at ? "Uloženo na GitHubu" : "" };
  }
}
function refreshSync() {
  const t = syncText();
  ["dSync", "histSync"].forEach(id => { const el = $(id); el.className = "sync " + t.cls; el.innerHTML = t.html ? '<span class="dot"></span><span>' + t.html + "</span>" : ""; });
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-link]");
  if (a) { e.preventDefault(); go(a.dataset.link); }
});

// ---------- obrazovka historie ----------
let histFilter = "all";
function renderHistory() {
  $("histFilter").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.f === histFilter)));
  refreshSync();
  const list = hist.filter(r => histFilter === "all" || r.sport === histFilter);
  const body = $("histBody");
  if (!list.length) { body.innerHTML = '<div class="empty"><p>Zatím tu nejsou žádné tréninky</p></div>'; return; }
  body.innerHTML = '<div class="hcard"></div>';
  list.forEach(r => {
    const b = document.createElement("button");
    b.innerHTML = `<span class="d num"></span><span class="n"><b></b><span></span></span><span class="t num"></span>`;
    b.querySelector(".d").textContent = dShort(r.date);
    b.querySelector(".n b").textContent = cleanTitle(r.name);
    b.querySelector(".n span").textContent = [histFilter === "all" ? SPORTS[r.sport].label : "", r.indoor ? "trenažér" : "", r.dist ? km(r.dist) : "", r.partial ? "nedokončeno" : ""].filter(Boolean).join(" · ");
    b.querySelector(".t").textContent = fmt(r.total);
    b.addEventListener("click", () => go("summary", { id: r.id }));
    body.firstChild.appendChild(b);
  });
}
$("histFilter").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { histFilter = b.dataset.f; renderHistory(); } });

// ---------- obrazovka souhrnu ----------
function devTxt(x, sport) {
  const d = x.dev, sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  if (x.planM) return Math.abs(d) <= Math.max(1, x.planM / x.target * .02) ? "v cíli" : sign + Math.round(Math.abs(d)) + " s";
  if (SPORTS[sport].metric === "speed") return Math.abs(d) <= .5 ? "v cíli" : sign + Math.abs(d).toFixed(1).replace(".", ",");
  return Math.abs(d) <= 3 ? "v cíli" : sign + Math.round(Math.abs(d)) + " s";
}
function renderSummary() {
  const n = curNav(), r = hist.find(x => x.id === n.id);
  if (!r) { $("dTitle").textContent = "Záznam nenalezen"; return; }
  const sp = SPORTS[r.sport] || SPORTS.beh;
  $("deleteBtn").hidden = !!n.fresh;
  $("closeBtn").textContent = n.fresh ? "Hotovo" : "Zpět na historii";
  $("dKicker").textContent = cap(dLong(r.date)) + (n.fresh ? "" : " · " + sp.label);
  $("dTitle").textContent = n.fresh ? (r.partial ? "Trénink ukončen" : "Hotovo") : cleanTitle(r.name);
  const keys0 = [...new Set(r.results.filter(x => x.series).map(x => x.series))];
  const st = [[fmt(r.total), "celkový čas"]];
  if (r.dist) st.push([kmNum(r.dist), "km"]);
  if (keys0.length) st.push([keys0.length, repWord(keys0.length, r.singleRep)]);
  $("dStats").innerHTML = st.map(([a, b]) => `<div class="fact"><b class="num">${esc(a)}</b><span>${esc(b)}</span></div>`).join("");
  refreshSync();

  const val = x => x.ok ? metric(x.sec, x.m, r.sport) : null;
  const bySer = {};
  r.results.forEach(x => { if (x.series && x.type === "interval") (bySer[x.series] = bySer[x.series] || []).push(x); });
  const keys = Object.keys(bySer).map(Number).sort((a, b) => a - b);
  const blockOf = k => bySer[k][0].block || 1;
  const blocks = [...new Set(keys.map(blockOf))];
  let tables = "";
  blocks.forEach((bl, bi) => {
    const bk = keys.filter(k => blockOf(k) === bl);
    const cols = r.indoor ? 0 : Math.max(...bk.map(k => bySer[k].length));
    const hasRpe = bk.some(k => r.rpe && r.rpe[k]);
    if (!cols && !hasRpe) return;
    const single = bk.every(k => bySer[k].length === 1);
    const allDist = bk.every(k => bySer[k].every(x => x.planM));
    const word = single ? "opakováních" : "sériích";
    const title = r.indoor ? "Pocit v " + word : allDist ? "Čas úseků v " + word : sp.metric === "speed" ? "Rychlost v " + word + ", km/h" : "Tempo v " + word + ", min/km";
    const ref = bySer[bk[0]];
    let h = `<div class="hd rl">${single ? "Opak." : "Série"}</div>`;
    for (let c = 0; c < cols; c++) { const x = ref[c] || bySer[bk.find(k => bySer[k][c])][c]; h += `<div class="hd">${esc(x.plan ? durLabel(x.plan) : x.planM ? distTxt(x.planM) : x.name)}</div>`; }
    if (hasRpe) h += '<div class="hd">Pocit</div>';
    bk.forEach((k, ri) => {
      h += `<div class="rl">${bySer[k][0].rep || ri + 1}.</div>`;
      for (let c = 0; c < cols; c++) {
        const x = bySer[k][c], v = x && val(x);
        if (v == null) { h += '<div class="num mut">—</div>'; continue; }
        h += `<div class="num cell2">${x.planM ? fmt(x.sec) : metricTxt(v, r.sport, false)}${x.target && x.dev != null ? `<span class="dv">${devTxt(x, r.sport)}</span>` : ""}</div>`;
      }
      if (hasRpe) { const v = r.rpe[k]; h += v ? `<div><span class="pill num" style="--h:${rpeHue(v)}">${v}</span></div>` : '<div class="mut">—</div>'; }
    });
    tables += `<h3${bi ? ' style="margin-top:var(--s-m)"' : ""}>${blocks.length > 1 ? (bi + 1) + ". blok · " : ""}${title}</h3>
      <div class="card"><div class="grid" style="grid-template-columns:auto repeat(${cols},minmax(0,1fr))${hasRpe ? " auto" : ""}">${h}</div></div>`;
  });
  $("seriesBody").innerHTML = tables;
  $("seriesTbl").hidden = !tables;
  const other = r.results.filter(x => !x.series && x.type !== "recovery");
  $("otherRows").innerHTML = other.map(x => { const v = val(x); return `<div class="r"><b>${esc(x.name)}</b><span class="num">${fmt(x.sec)}${x.ok && x.m ? " · " + km(x.m) : ""}</span><em class="num">${metricTxt(v, r.sport)}</em></div>`; }).join("");
  $("otherSec").hidden = !other.length;
  $("otherTitle").textContent = other.every(x => x.type === "warmup" || x.type === "cooldown") ? sp.names.warmup + " a " + sp.names.cooldown.toLowerCase() : "Úseky";

  // trenérský postřeh: první vs. poslední série
  const ins = $("insight");
  $("insightSec").hidden = true;
  const fk = keys.filter(k => blockOf(k) === blocks[0]);
  if (fk.length >= 2 && !r.indoor) {
    const a = bySer[fk[0]], b = bySer[fk[fk.length - 1]];
    let sa = 0, sb = 0, cnt = 0;
    for (let c = 0; c < Math.min(a.length, b.length); c++) { const pa = val(a[c]), pb = val(b[c]); if (pa != null && pb != null) { sa += pa; sb += pb; cnt++; } }
    if (cnt) {
      let t, col;
      if (sp.metric === "speed") {
        const d = (sb - sa) / cnt, dt = Math.abs(d).toFixed(1).replace(".", ",");
        if (Math.abs(d) <= .5) { t = "Poslední série byla stejně rychlá jako první. Přesně tak to má být."; col = "var(--m-recovery)"; }
        else if (d < 0) { t = `Poslední série byla o ${dt} km/h pomalejší než první. Příště začni první úsek o kousek volněji.`; col = "var(--m-interval)"; }
        else { t = `Poslední série byla o ${dt} km/h rychlejší než první. Máš rezervu, příště můžeš začít svižněji.`; col = "var(--m-warmup)"; }
      } else {
        const d = Math.round((sb - sa) / cnt);
        if (Math.abs(d) <= 3) { t = "Poslední série byla stejně rychlá jako první. Přesně tak to má být."; col = "var(--m-recovery)"; }
        else if (d > 0) { t = `Poslední série byla o ${d} s/km pomalejší než první. Příště začni první úsek o kousek volněji.`; col = "var(--m-interval)"; }
        else { t = `Poslední série byla o ${-d} s/km rychlejší než první. Máš rezervu, příště můžeš začít svižněji.`; col = "var(--m-warmup)"; }
      }
      if (fk.every(k => bySer[k].length === 1)) t = t.replace("Poslední série byla", "Poslední opakování bylo").replace("stejně rychlá", "stejně rychlé");
      ins.textContent = t; ins.style.setProperty("--accent", col); $("insightSec").hidden = false;
    }
  }
  const missing = !r.indoor && r.results.some(x => x.type !== "recovery" && val(x) == null);
  $("dNote").textContent = missing ? "Pomlčka znamená, že GPS nemělo dost dat, nejčastěji kvůli slabému signálu nebo zamčenému displeji" : "";
  $("dNote").hidden = !missing;
}
$("closeBtn").addEventListener("click", () => {
  hideRpe();
  back();
});
$("deleteBtn").addEventListener("click", () => {
  const id = curNav().id, pos = hist.findIndex(r => r.id === id), removed = hist[pos];
  if (!removed) return;
  hist.splice(pos, 1); deletedIds.add(id); store.set("deletedIds", [...deletedIds]); saveHist(); scheduleSync();
  back();
  toast("Trénink smazán z historie", () => {
    deletedIds.delete(id); store.set("deletedIds", [...deletedIds]);
    removed.updated = Date.now(); hist.splice(pos, 0, removed); saveHist(); scheduleSync(); refresh();
  });
});

// ---------- oznámení s možností vrátit ----------
let toastT = null, undoFn = null, toastDone = null;
function toast(text, undo, onExpire) {
  if (toastDone) { const f = toastDone; toastDone = null; f(); }
  $("toastText").textContent = text; undoFn = undo || null; toastDone = onExpire || null;
  $("toastUndo").hidden = !undo; $("toast").hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { $("toast").hidden = true; undoFn = null; if (toastDone) { const f = toastDone; toastDone = null; f(); } }, 6000);
}
$("toastUndo").addEventListener("click", () => {
  clearTimeout(toastT); $("toast").hidden = true; toastDone = null;
  if (undoFn) { const f = undoFn; undoFn = null; f(); }
});

// =========================================================
// Správa tréninků
// =========================================================
function renderManage() {
  const sport = curNav().sport || store.get("lastSport", "beh");
  curNav().sport = sport;
  const hasToken = !!gh.token();
  $("manageNoToken").hidden = hasToken;
  $("manageActions").hidden = !hasToken;
  $("manageDock").hidden = !hasToken;
  $("manageSport").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.s === sport)));
  const body = $("manageBody");
  body.innerHTML = "";
  const all = workoutsOf(sport);
  if (!all.length) { body.innerHTML = '<div class="empty"><p>Zatím tu nejsou žádné tréninky</p></div>'; return; }
  typesOf(sport).forEach(type => {
    const list = all.filter(w => w.type === type);
    if (!list.length) return;
    const g = document.createElement("section");
    g.className = "group";
    g.innerHTML = `<h2>${esc(type)}</h2><div class="card" style="padding:0"></div>`;
    list.forEach(w => {
      const row = document.createElement("div");
      row.className = "wrow";
      row.innerHTML = `<div class="wmain"><b></b><span></span></div>`;
      row.querySelector("b").textContent = cleanTitle(w.name);
      row.querySelector("span").textContent = workoutMeta(w);
      if (hasToken) {
        const ed = document.createElement("button");
        ed.className = "mrow-del edit"; ed.textContent = "Upravit";
        ed.setAttribute("aria-label", "Upravit trénink " + cleanTitle(w.name));
        ed.addEventListener("click", () => editWorkout(w));
        row.appendChild(ed);
        const d = document.createElement("button");
        d.className = "mrow-del"; d.textContent = "Smazat";
        d.setAttribute("aria-label", "Smazat trénink " + cleanTitle(w.name));
        d.addEventListener("click", () => deleteWorkout(w));
        row.appendChild(d);
      }
      g.querySelector(".card").appendChild(row);
    });
    body.appendChild(g);
  });
}
$("manageSport").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { curNav().sport = b.dataset.s; renderManage(); } });
$("goSettingsBtn").addEventListener("click", () => go("settings"));
$("newBtn").addEventListener("click", () => go("editor", { draft: newDraft(curNav().sport || "beh") }));
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const obj = cleanGarmin(JSON.parse(await f.text()));
    const p = parseJson(obj);
    go("editor", { draft: garminToDraft(obj, { mode: "import", name: p.name, sport: p.sport }) });
  } catch (err) {
    toast("Soubor se nepodařilo načíst: " + err.message);
  }
});

/** Mazání s možností vrátit: soubor se z GitHubu smaže až po 6 s */
function deleteWorkout(w) {
  const pos = library.indexOf(w);
  library.splice(pos, 1); store.set("library4", library); renderManage();
  toast("Trénink smazán", () => { library.splice(pos, 0, w); store.set("library4", library); refresh(); }, async () => {
    try { await gh.del(w.path, w.sha, "Smazán trénink " + cleanTitle(w.name)); }
    catch (e) { library.splice(pos, 0, w); store.set("library4", library); refresh(); toast("Smazání se nepovedlo, zkus to znovu"); }
  });
}

// =========================================================
// Editor tréninku – seznam kroků a bloků opakování (inspirace Garmin Connect / Polar Flow)
// Krok = typ + délka (čas / vzdálenost / do stisku tlačítka) + volitelný cíl tempa či rychlosti
// =========================================================
const uid = () => Math.random().toString(36).slice(2, 9);
const STEP_TYPES = ["warmup", "interval", "recovery", "cooldown"];
const mkStep = (type, end, value, extra = {}) => ({ id: uid(), kind: "step", type, end, value, target: null, desc: "", ...extra });

function newDraft(sport) {
  const run = sport !== "kolo";
  return {
    mode: "new", name: "", sport, type: "Intervaly", newType: "", errors: null,
    steps: [
      run ? mkStep("warmup", "distance", 1000) : mkStep("warmup", "time", 600),
      { id: uid(), kind: "repeat", count: 4, skipLast: true, steps: [mkStep("interval", "time", 180), mkStep("recovery", "time", 60)] },
      mkStep("cooldown", "open", 0),
    ],
  };
}
/** Garmin JSON → kroky editoru (zachová opakování i cíle) */
function garminToSteps(list) {
  return (list || []).map(s => {
    if (s.type === "RepeatGroupDTO" || (s.stepType && s.stepType.stepTypeKey === "repeat")) {
      return { id: uid(), kind: "repeat", count: Math.max(1, Number(s.numberOfIterations || s.endConditionValue || 1)), skipLast: !!s.skipLastRestStep,
               steps: garminToSteps(s.workoutSteps).filter(x => x.kind === "step") };
    }
    const key = (s.stepType && s.stepType.stepTypeKey) || "", cond = (s.endCondition && s.endCondition.conditionTypeKey) || "";
    const type = STEP_TYPES.includes(key) ? key : key === "rest" ? "recovery" : "interval";
    const v = Number(s.endConditionValue) || 0;
    let end = "open", value = 0;
    if (cond === "time") { end = "time"; value = v; }
    else if (cond === "distance") { end = "distance"; value = v || 1000; }
    else if (cond === "lap.button" && v >= 500) { end = "distance"; value = v; }
    const tk = (s.targetType && s.targetType.workoutTargetTypeKey) || "";
    const t1 = Number(s.targetValueOne) || 0, t2 = Number(s.targetValueTwo) || 0;
    const target = /pace|speed/.test(tk) && (t1 || t2) ? (t1 && t2 ? (t1 + t2) / 2 : t1 || t2) : null;
    return mkStep(type, end, value, { target, desc: (s.description || "").trim() });
  });
}
function garminToDraft(obj, extra) {
  const steps = [];
  (obj.workoutSegments || []).forEach(seg => steps.push(...garminToSteps(seg.workoutSteps)));
  return { errors: null, newType: "", type: "Intervaly", name: obj.workoutName || "", sport: sportFromGarmin(obj), steps, ...extra };
}
/** Kroky editoru → Garmin JSON (stejný formát jako export z Garmin Connect) */
function draftToGarmin(d) {
  const sp = SPORTS[d.sport];
  let order = 1;
  const conv = x => {
    if (x.kind === "repeat") {
      return { type: "RepeatGroupDTO", stepOrder: order++, stepType: { stepTypeKey: "repeat" }, numberOfIterations: x.count,
               skipLastRestStep: x.skipLast, endCondition: { conditionTypeKey: "iterations" }, endConditionValue: x.count, workoutSteps: x.steps.map(conv) };
    }
    const o = { type: "ExecutableStepDTO", stepOrder: order++, stepType: { stepTypeKey: x.type },
                endCondition: { conditionTypeKey: x.end === "open" ? "lap.button" : x.end }, endConditionValue: x.end === "open" ? null : x.value,
                description: x.desc || null, targetType: { workoutTargetTypeKey: "no.target" } };
    if (x.target) Object.assign(o, { targetType: { workoutTargetTypeKey: sp.metric === "speed" ? "speed.zone" : "pace.zone" },
                                     targetValueOne: +(x.target * .98).toFixed(3), targetValueTwo: +(x.target * 1.02).toFixed(3) });
    return o;
  };
  return { workoutName: d.name.trim(), description: null, sportType: { sportTypeKey: sp.garmin },
           workoutSegments: [{ segmentOrder: 1, sportType: { sportTypeKey: sp.garmin }, workoutSteps: d.steps.map(conv) }] };
}

// ---------- pomocné ----------
const stepName = (x, sport) => x.desc || SPORTS[sport].names[x.type];
function stepSummary(x, sport) {
  const v = x.end === "time" ? fmt(x.value) : x.end === "distance" ? distTxt(x.value) : "Do stisku tlačítka";
  const t = x.target ? (SPORTS[sport].metric === "speed" ? "rychlost " : "tempo ") + targetTxt(x.target, sport) : "";
  return [x.desc ? SPORTS[sport].names[x.type] : "", v, t].filter(Boolean).join(" · ");
}
const findAt = (d, path) => path.length === 1 ? { list: d.steps, i: path[0] } : { list: d.steps[path[0]].steps, i: path[1] };
const getAt = (d, path) => { const { list, i } = findAt(d, path); return list[i]; };

// ---------- validace ----------
function stepProblem(x, sport) {
  if (x.end === "time" && !(x.value > 0)) return "Zadej čas kroku";
  if (x.end === "distance" && !(x.value > 0)) return "Zadej vzdálenost kroku";
  if (x.target != null && !(x.target > 0)) return SPORTS[sport].metric === "speed" ? "Zadej cílovou rychlost" : "Zadej cílové tempo";
  return "";
}
function validateDraft(d) {
  const list = [], byId = {};
  const type = d.type === "__new" ? d.newType.trim() : d.type;
  if (!d.name.trim()) list.push({ msg: "Zadej název tréninku", focus: "edName" });
  if (!type) list.push({ msg: "Zadej název nového typu tréninku", focus: "edNewType" });
  else if (/[\/\\]/.test(type)) list.push({ msg: "Název typu nesmí obsahovat lomítko", focus: "edNewType" });
  if (!d.steps.length) list.push({ msg: "Přidej aspoň jeden krok", focus: "edAddStep" });
  d.steps.forEach((x, i) => {
    if (x.kind === "repeat") {
      if (!x.steps.length) { byId[x.id] = "Opakování je prázdné, přidej do něj krok"; list.push({ msg: `Opakování (${i + 1}. položka) je prázdné`, focus: "step-" + x.id }); }
      x.steps.forEach((y, j) => { const p = stepProblem(y, d.sport); if (p) { byId[y.id] = p; list.push({ msg: `${stepName(y, d.sport)} v opakování (${j + 1}. krok): ${p.toLowerCase()}`, focus: "step-" + y.id }); } });
    } else {
      const p = stepProblem(x, d.sport);
      if (p) { byId[x.id] = p; list.push({ msg: `${stepName(x, d.sport)} (${i + 1}. krok): ${p.toLowerCase()}`, focus: "step-" + x.id }); }
    }
  });
  if (!gh.token()) list.push({ msg: "Pro uložení je potřeba připojit GitHub v Nastavení", link: "settings" });
  return list.length ? { list, byId } : null;
}

// ---------- vykreslení editoru ----------
function stepCard(x, path, sport, err) {
  return `<button class="scard${err ? " bad" : ""}" id="step-${x.id}" data-path="${path.join(".")}" data-type="${x.type}">
    <span class="bar" aria-hidden="true"></span>
    <span class="smain"><b>${esc(stepName(x, sport))}</b><span class="meta">${esc(stepSummary(x, sport))}</span>${err ? `<span class="error">${esc(err)}</span>` : ""}</span>${ICON_CHEV}</button>`;
}
function renderEditor() {
  const n = curNav(), d = n.draft;
  if (!d) return;
  $("edTitle").textContent = d.mode === "edit" ? "Upravit trénink" : d.mode === "import" ? "Nahrát trénink" : "Nový trénink";
  $("saveBtn").textContent = d.saving ? "Ukládám…" : "Uložit trénink";
  const sp = SPORTS[d.sport], e = d.errors, byId = (e && e.byId) || {};
  let h = "";
  if (e && e.list.length) {
    h += `<div class="errsum" id="errSum" role="alert" tabindex="-1"><b>Trénink zatím nejde uložit</b><ul>${e.list.map(x =>
      `<li>${x.link ? `${esc(x.msg)} · <a href="#" data-link="${x.link}">Otevřít Nastavení</a>` : x.focus ? `<a href="#" data-errfocus="${x.focus}">${esc(x.msg)}</a>` : esc(x.msg)}</li>`).join("")}</ul></div>`;
  }
  const nameErr = e && e.list.find(x => x.focus === "edName"), typeErr = e && e.list.find(x => x.focus === "edNewType");
  h += `
   <div class="field"><label for="edName">Název</label>
    <input class="input${nameErr ? " bad" : ""}" id="edName" value="${esc(d.name)}" placeholder="např. 4x (3-2-1 min)" autocomplete="off">
    ${nameErr ? `<p class="error">${esc(nameErr.msg)}</p>` : ""}</div>
   <div class="field"><span class="lbl">Sport</span>
    <div class="seg" style="margin-top:0" data-sportseg>${Object.values(SPORTS).map(s => `<button data-s="${s.key}" aria-pressed="${d.sport === s.key}">${s.label}</button>`).join("")}</div></div>
   <div class="field"><span class="lbl">Typ tréninku</span>
    <div class="chips" data-typechips>${typesOf(d.sport).map(t => `<button class="chip" data-t="${esc(t)}" aria-pressed="${d.type === t}">${esc(t)}</button>`).join("")}<button class="chip" data-t="__new" aria-pressed="${d.type === "__new"}">Jiný…</button></div>
    ${d.type === "__new" ? `<input class="input${typeErr ? " bad" : ""}" id="edNewType" style="margin-top:var(--s-xs)" value="${esc(d.newType)}" placeholder="Název nového typu" aria-label="Název nového typu">` : ""}
    ${typeErr ? `<p class="error">${esc(typeErr.msg)}</p>` : ""}</div>
   <div class="field"><span class="lbl">Kroky</span><p class="help" style="margin-top:0">Ťukni na krok a uprav ho</p>`;
  d.steps.forEach((x, i) => {
    if (x.kind === "repeat") {
      h += `<div class="rbox${byId[x.id] ? " bad" : ""}" id="step-${x.id}" data-rpath="${i}">
        <div class="rhead"><span class="lbl">Opakovat</span>
         <div class="stepper"><button data-rep="-1" aria-label="Méně opakování">−</button><output>${x.count}×</output><button data-rep="1" aria-label="Více opakování">+</button></div></div>
        ${x.steps.map((y, j) => stepCard(y, [i, j], d.sport, byId[y.id])).join("")}
        ${byId[x.id] ? `<p class="error">${esc(byId[x.id])}</p>` : ""}
        <label class="check"><input type="checkbox" data-skip ${x.skipLast ? "checked" : ""}><span>Vynechat poslední pauzu<span class="sub">Po posledním opakování se rovnou pokračuje dál</span></span></label>
        <div class="rfoot"><button class="btn-tertiary" data-addin>+ Krok do opakování</button><button class="btn-tertiary danger" data-delrep>Smazat opakování</button></div>
      </div>`;
    } else h += stepCard(x, [i], d.sport, byId[x.id]);
  });
  h += `<div class="addrow"><button class="btn btn-secondary" id="edAddStep">+ Krok</button><button class="btn btn-secondary" id="edAddRepeat">+ Opakování</button></div></div>
   <div class="preview"><div class="meta" id="edMeta"></div><div class="strip" id="edStrip" aria-hidden="true"></div></div>`;
  $("edBody").innerHTML = h;
  updatePreview();
}
function updatePreview() {
  const d = curNav().draft;
  try {
    const p = parseJson(draftToGarmin({ ...d, name: d.name || "x" }), d.sport);
    $("edMeta").textContent = "Náhled · " + workoutMeta({ ...p, sport: d.sport }) + " · " + p.steps.length + " " + plural(p.steps.length, "krok", "kroky", "kroků");
    buildStrip($("edStrip"), p.steps, d.sport);
  } catch (err) { $("edMeta").textContent = "Náhled se zobrazí, až přidáš kroky"; $("edStrip").innerHTML = ""; }
}
/** Po úpravě zmizí chyby, které už neplatí (hlavní seznam se přepočítá) */
function revalidate(d) { if (d.errors) d.errors = validateDraft(d); }

$("edBody").addEventListener("input", e => {
  const d = curNav().draft, t = e.target;
  if (t.id === "edName") { d.name = t.value; if (d.errors) { d.errors = validateDraft(d); if (t.value.trim()) { t.classList.remove("bad"); const er = t.parentElement.querySelector(".error"); if (er) er.remove(); } } }
  else if (t.id === "edNewType") d.newType = t.value;
  updatePreview();
});
$("edBody").addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.skip !== undefined) { const d = curNav().draft; d.steps[+t.closest("[data-rpath]").dataset.rpath].skipLast = t.checked; updatePreview(); }
});
$("edBody").addEventListener("click", e => {
  const d = curNav().draft;
  const f = e.target.closest("[data-errfocus]");
  if (f) {
    e.preventDefault();
    const el = $(f.dataset.errfocus);
    if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); if (el.tagName === "INPUT") el.focus({ preventScroll: true }); }
    return;
  }
  const card = e.target.closest(".scard");
  if (card) { openStepSheet(d, card.dataset.path.split(".").map(Number), false); return; }
  const b = e.target.closest("button");
  if (!b) return;
  const rbox = b.closest("[data-rpath]"), ri = rbox ? +rbox.dataset.rpath : -1;
  if (b.closest("[data-sportseg]")) d.sport = b.dataset.s;
  else if (b.closest("[data-typechips]")) d.type = b.dataset.t;
  else if (b.dataset.rep) { const r = d.steps[ri]; r.count = Math.min(50, Math.max(1, r.count + Number(b.dataset.rep))); }
  else if (b.dataset.delrep !== undefined) {
    const removed = d.steps.splice(ri, 1)[0];
    renderEditor();
    toast("Opakování smazáno", () => { d.steps.splice(ri, 0, removed); renderEditor(); });
    return;
  }
  else if (b.dataset.addin !== undefined) {
    const r = d.steps[ri], last = r.steps[r.steps.length - 1];
    r.steps.push(last && last.type === "interval" ? mkStep("recovery", "time", 60) : mkStep("interval", "time", 60));
    openStepSheet(d, [ri, r.steps.length - 1], true);
  }
  else if (b.id === "edAddStep") { const at = insertAt(d); d.steps.splice(at, 0, mkStep("interval", "time", 300)); openStepSheet(d, [at], true); }
  else if (b.id === "edAddRepeat") d.steps.splice(insertAt(d), 0, { id: uid(), kind: "repeat", count: 4, skipLast: true, steps: [mkStep("interval", "time", 60), mkStep("recovery", "time", 60)] });
  else return;
  revalidate(d);
  renderEditor();
});

/** Nové kroky se vkládají před závěrečný výklus, jako v Garmin Connect */
function insertAt(d) {
  const last = d.steps[d.steps.length - 1];
  return last && last.kind === "step" && last.type === "cooldown" ? d.steps.length - 1 : d.steps.length;
}

// ---------- panel pro úpravu jednoho kroku ----------
let sheet = null; // { d, path, isNew, x: kopie kroku, unit, err }
function openStepSheet(d, path, isNew) {
  const x = { ...getAt(d, path) };
  sheet = { d, path, isNew, x, unit: x.end === "distance" && x.value >= 1000 && x.value % 100 === 0 ? "km" : "m", err: "", targetOn: x.target != null };
  renderStepSheet();
  $("stepSheet").hidden = false; $("stepScrim").hidden = false;
}
function closeStepSheet(cancel) {
  if (!sheet) return;
  if (cancel && sheet.isNew) { const { list, i } = findAt(sheet.d, sheet.path); list.splice(i, 1); }
  sheet = null;
  $("stepSheet").hidden = true; $("stepScrim").hidden = true;
  renderEditor();
}
function renderStepSheet() {
  const s = sheet, x = s.x, sp = SPORTS[s.d.sport];
  const mm = Math.floor((x.value || 0) / 60), ss = Math.round((x.value || 0) % 60);
  const tSec = x.target ? 1000 / x.target : 0;
  const { list, i } = findAt(s.d, s.path);
  let h = `<div class="grab"></div><h2 id="stepTitle">${s.isNew ? "Nový krok" : "Upravit krok"}</h2>
   <div class="field"><span class="lbl">Typ kroku</span>
    <div class="chips" data-stype>${STEP_TYPES.map(t => `<button class="chip" data-t="${t}" aria-pressed="${x.type === t}">${sp.names[t]}</button>`).join("")}</div></div>
   <div class="field"><span class="lbl">Délka kroku</span>
    <div class="seg" style="margin-top:0" data-send>
     <button data-e="time" aria-pressed="${x.end === "time"}">Čas</button><button data-e="distance" aria-pressed="${x.end === "distance"}">Vzdálenost</button><button data-e="open" aria-pressed="${x.end === "open"}">Tlačítko</button></div>`;
  if (x.end === "time") h += `<div class="inline"><input class="input small" id="stMin" inputmode="numeric" value="${mm || (x.value ? 0 : "")}" aria-label="Minuty"><span class="unit">min</span><input class="input small" id="stSec" inputmode="numeric" value="${x.value ? String(ss).padStart(2, "0") : ""}" aria-label="Sekundy"><span class="unit">s</span></div>`;
  if (x.end === "distance") h += `<div class="inline"><input class="input small" id="stDist" inputmode="decimal" value="${x.value ? (s.unit === "km" ? String(x.value / 1000).replace(".", ",") : x.value) : ""}" aria-label="Vzdálenost">
     <div class="seg mini" data-sunit><button data-u="m" aria-pressed="${s.unit === "m"}">m</button><button data-u="km" aria-pressed="${s.unit === "km"}">km</button></div></div>
     <p class="help">Venku se měří přes GPS, na trenažéru krok ukončíš tlačítkem</p>`;
  if (x.end === "open") h += `<p class="help">Krok skončí, až ťukneš na Úsek hotový. Hodí se na rozklus nebo výklus bez pevné délky.</p>`;
  if (s.err && !/cíl/i.test(s.err)) h += `<p class="error" role="alert">${esc(s.err)}</p>`;
  h += `</div>
   <div class="field"><span class="lbl">Cíl</span>
    <div class="seg" style="margin-top:0" data-starget><button data-on="0" aria-pressed="${!s.targetOn}">Bez cíle</button><button data-on="1" aria-pressed="${s.targetOn}">${sp.metric === "speed" ? "Rychlost" : "Tempo"}</button></div>
    ${s.targetOn ? (sp.metric === "speed"
      ? `<div class="inline"><input class="input small" id="stSpeed" inputmode="decimal" value="${x.target ? String(+(x.target * 3.6).toFixed(1)).replace(".", ",") : ""}" aria-label="Cílová rychlost"><span class="unit">km/h</span></div>`
      : `<div class="inline"><input class="input small" id="stPm" inputmode="numeric" value="${tSec ? Math.floor(tSec / 60) : ""}" aria-label="Tempo, minuty"><span class="unit">:</span><input class="input small" id="stPs" inputmode="numeric" value="${tSec ? String(Math.round(tSec % 60)).padStart(2, "0") : ""}" aria-label="Tempo, sekundy"><span class="unit">min/km</span></div>`)
      : ""}
    ${s.targetOn ? `<p class="help">Po kroku ti aplikace řekne, jestli jsi v cíli</p>` : ""}
    ${s.err && /cíl/i.test(s.err) ? `<p class="error" role="alert">${esc(s.err)}</p>` : ""}</div>
   <div class="field"><label for="stDesc">Popis <span class="opt">nepovinný</span></label>
    <input class="input" id="stDesc" value="${esc(x.desc)}" placeholder="např. Tempo na 10 km" autocomplete="off"></div>
   <button class="btn btn-primary" id="stDone" style="margin-top:var(--s-m)">Hotovo</button>
   ${s.isNew ? "" : `<div class="sheetfoot">
     <button class="btn-tertiary" data-move="-1" ${i === 0 ? "hidden" : ""}>Posunout výš</button>
     <button class="btn-tertiary" data-move="1" ${i === list.length - 1 ? "hidden" : ""}>Posunout níž</button>
     <button class="btn-tertiary danger" id="stDel">Smazat krok</button></div>`}`;
  $("stepBody").innerHTML = h;
}
/** Přečte hodnoty z polí panelu do kopie kroku */
function readSheetInputs() {
  const s = sheet, x = s.x, sp = SPORTS[s.d.sport];
  const num = id => { const el = $(id); return el ? parseFloat(el.value.replace(",", ".")) : NaN; };
  if ($("stDesc")) x.desc = $("stDesc").value.trim();
  if (x.end === "time" && $("stMin")) x.value = Math.round((num("stMin") || 0) * 60 + (num("stSec") || 0));
  if (x.end === "distance" && $("stDist")) { const v = num("stDist"); x.value = v > 0 ? Math.round(s.unit === "km" ? v * 1000 : v) : 0; }
  if (!s.targetOn) x.target = null;
  else if (sp.metric === "speed" && $("stSpeed")) { const v = num("stSpeed"); x.target = v > 0 ? v / 3.6 : 0; }
  else if ($("stPm")) { const sec = (num("stPm") || 0) * 60 + (num("stPs") || 0); x.target = sec > 0 ? 1000 / sec : 0; }
}
$("stepScrim").addEventListener("click", () => closeStepSheet(true));
$("stepBody").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || !sheet) return;
  const s = sheet, x = s.x;
  readSheetInputs();
  if (b.closest("[data-stype]")) x.type = b.dataset.t;
  else if (b.closest("[data-send]")) {
    if (x.end !== b.dataset.e) { x.end = b.dataset.e; x.value = x.end === "time" ? 60 : x.end === "distance" ? 400 : 0; s.unit = "m"; }
  }
  else if (b.closest("[data-sunit]")) s.unit = b.dataset.u;
  else if (b.closest("[data-starget]")) s.targetOn = b.dataset.on === "1";
  else if (b.dataset.move) {
    const { list, i } = findAt(s.d, s.path), j = i + Number(b.dataset.move);
    list[i] = { ...x };
    [list[i], list[j]] = [list[j], list[i]];
    sheet = null; $("stepSheet").hidden = true; $("stepScrim").hidden = true;
    renderEditor();
    return;
  }
  else if (b.id === "stDel") {
    const { list, i } = findAt(s.d, s.path), removed = list.splice(i, 1)[0];
    sheet = null; $("stepSheet").hidden = true; $("stepScrim").hidden = true;
    revalidate(s.d); renderEditor();
    toast("Krok smazán", () => { list.splice(i, 0, removed); revalidate(s.d); renderEditor(); });
    return;
  }
  else if (b.id === "stDone") {
    const p = stepProblem(x, s.d.sport);
    if (p) { s.err = p; renderStepSheet(); const er = $("stepBody").querySelector(".error"); if (er) er.scrollIntoView({ block: "center", behavior: "smooth" }); return; }
    const { list, i } = findAt(s.d, s.path);
    list[i] = { ...x };
    sheet = null; $("stepSheet").hidden = true; $("stepScrim").hidden = true;
    revalidate(s.d); renderEditor();
    return;
  }
  else return;
  s.err = "";
  renderStepSheet();
});

// ---------- uložení ----------
$("saveBtn").addEventListener("click", async () => {
  const d = curNav().draft;
  if (!d || d.saving) return;
  d.errors = validateDraft(d);
  if (d.errors) {
    renderEditor();
    const el = $("errSum");
    if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); el.focus({ preventScroll: true }); }
    return;
  }
  const type = d.type === "__new" ? d.newType.trim() : d.type;
  const obj = draftToGarmin(d);
  const text = JSON.stringify(obj, null, 2) + "\n";
  const dir = `${CFG.dir}/${d.sport}/${type}/`;
  let path = d.path && d.path.startsWith(dir) ? d.path : null;
  if (!path) { const base = dir + slug(d.name); path = base + ".json"; let i = 2; while (library.some(w => w.path === path && w.path !== d.path)) path = `${base}-${i++}.json`; }
  d.saving = true; renderEditor();
  try {
    const sha = await gh.put(path, text, path === d.path ? d.sha : null, (d.mode === "edit" ? "Upraven trénink " : "Nový trénink ") + d.name.trim());
    if (d.path && path !== d.path) { try { await gh.del(d.path, d.sha, "Přesun tréninku " + d.name.trim()); } catch (e) {} }
    library = library.filter(w => w.path !== d.path && w.path !== path);
    library.push({ ...fromFile(path, sha, obj), path, sha });
    store.set("library4", library);
    d.saving = false;
    nav = [{ screen: "home" }, { screen: "list", sport: d.sport }];
    history.pushState({ n: 2 }, "");
    show();
    toast(d.mode === "edit" ? "Změny uloženy" : "Trénink uložen");
  } catch (e) {
    d.saving = false;
    const msg = e.status === 401 || e.status === 403 ? "GitHub odmítl token. Zkontroluj ho v Nastavení."
      : e.status === 409 || e.status === 422 ? "Trénink se mezitím změnil na GitHubu. Vrať se do seznamu a otevři ho znovu."
      : !navigator.onLine ? "Telefon je offline. Uložit půjde, až bude připojení."
      : "Uložení se nepovedlo (chyba " + (e.status || "spojení") + "). Zkus to za chvíli znovu.";
    d.errors = { list: [{ msg, link: e.status === 401 || e.status === 403 ? "settings" : null }], byId: {} };
    renderEditor();
    const el = $("errSum"); if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); el.focus({ preventScroll: true }); }
  }
});

/** Úprava existujícího tréninku: načte soubor z GitHubu a otevře ho v editoru */
async function editWorkout(w) {
  try {
    const obj = JSON.parse(await gh.raw(w.path));
    go("editor", { draft: garminToDraft(obj, { mode: "edit", path: w.path, sha: w.sha, sport: w.sport, type: w.type }) });
  } catch (e) { toast("Trénink se nepodařilo načíst, zkontroluj připojení"); }
}

// =========================================================
// Nastavení
// =========================================================
function renderSettings() {
  $("setVoice").checked = settings.voice;
  $("setCountdown").checked = settings.countdown;
  $("setBeep").checked = settings.beep;
  const has = !!gh.token();
  $("ghStatus").innerHTML = has ? '<span class="ok">Připojeno</span> · výsledky a tréninky se ukládají na GitHub' : "Nepřipojeno · výsledky se ukládají jen v telefonu";
  $("ghToken").value = "";
  $("ghToken").placeholder = has ? "Token je uložený, pro změnu vlož nový" : "github_pat_…";
  $("ghRemove").hidden = !has;
  $("ghError").hidden = true;
}
[["setVoice", "voice"], ["setCountdown", "countdown"], ["setBeep", "beep"]].forEach(([id, k]) => {
  $(id).addEventListener("change", () => { settings[k] = $(id).checked; store.set("settings", settings); });
});
$("ghSave").addEventListener("click", async () => {
  const t = $("ghToken").value.trim();
  const err = $("ghError");
  if (!t) { err.textContent = "Vlož token z GitHubu"; err.hidden = false; return; }
  const prev = gh.token();
  store.set("ghToken", t);
  $("ghSave").textContent = "Ověřuji…";
  try {
    const ok = await gh.check();
    if (!ok) throw Object.assign(new Error(), { status: 403 });
    sync.state = "idle";
    renderSettings();
    toast("GitHub připojen");
    syncHistory();
  } catch (e) {
    store.set("ghToken", prev);
    err.textContent = e.status === 401 ? "Token je neplatný nebo vypršel" : e.status === 403 || e.status === 404 ? "Token nemá právo zapisovat do repozitáře running-app" : "Ověření se nepovedlo, zkontroluj připojení";
    err.hidden = false;
  }
  $("ghSave").textContent = "Uložit a ověřit";
});
$("ghRemove").addEventListener("click", () => {
  const prev = gh.token();
  store.set("ghToken", "");
  sync.state = "off";
  renderSettings();
  toast("GitHub odpojen", () => { store.set("ghToken", prev); sync.state = "idle"; renderSettings(); });
});

// =========================================================
// Start aplikace
// =========================================================
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (runState === "running") { unlockAudio(); getWakeLock(); tick(); return; }
  loadLibrary();
  if (gh.token() && sync.state !== "ok") syncHistory();
});
addEventListener("online", () => { if (gh.token()) syncHistory(); });
if ("speechSynthesis" in window) speechSynthesis.getVoices();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

history.replaceState({ n: 1 }, "");
show();
loadLibrary(true);
if (gh.token()) syncHistory();
