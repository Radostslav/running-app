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
const isWalk = s => /chůz|chuz|walk/i.test(s.name);
const estSec = (s, sport = "beh") => {
  if (s.kind === "time") return s.seconds;
  if (s.kind === "open") return s.type === "cooldown" ? 300 : 360;
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
  let maxS = 0;
  function mk(s, series) {
    const key = (s.stepType && s.stepType.stepTypeKey) || "", cond = (s.endCondition && s.endCondition.conditionTypeKey) || "";
    const type = ["warmup", "interval", "recovery", "cooldown"].includes(key) ? key : key === "rest" ? "recovery" : "interval";
    const raw = (s.description || "").trim(), v = Number(s.endConditionValue) || 0;
    let name = raw ? raw[0].toUpperCase() + raw.slice(1) : fb[type];
    if (cond === "time") { if (!raw && type === "interval") name = "Interval " + durLabel(v); return { name, type, series, kind: "time", seconds: v }; }
    if (cond === "distance") return { name, type, series, kind: "distance", meters: v || 1000 };
    // „do stisku tlačítka“: hodnotu od 500 m ber jako vzdálenost, jinak úsek ukončíš sám
    if (cond === "lap.button") return v >= 500 ? { name, type, series, kind: "distance", meters: v } : { name, type, series, kind: "open" };
    return null;
  }
  function visit(steps, series) {
    (steps || []).forEach(s => {
      if (s.type === "RepeatGroupDTO" || (s.stepType && s.stepType.stepTypeKey === "repeat")) {
        const reps = Math.max(1, Number(s.numberOfIterations || s.endConditionValue || 1));
        maxS = Math.max(maxS, reps);
        for (let r = 0; r < reps; r++) {
          const before = out.length;
          visit(s.workoutSteps, series || r + 1);
          if (r === reps - 1 && s.skipLastRestStep && out.length > before && out[out.length - 1].type === "recovery") out.pop();
        }
        return;
      }
      const st = mk(s, series);
      if (st && (st.kind !== "time" || st.seconds > 0)) out.push(st);
    });
  }
  (obj.workoutSegments || []).forEach(seg => visit(seg.workoutSteps, 0));
  if (!out.length) throw new Error("v souboru nejsou kroky tréninku");
  if (!maxS) maxS = inferSeries(out);
  const lastInt = {};
  out.forEach((s, i) => { if (s.series && s.type === "interval") lastInt[s.series] = i; });
  Object.values(lastInt).forEach(i => { out[i].seriesEnd = true; });
  return { name: obj.workoutName || "Trénink", sport, steps: out, seriesCount: maxS };
}
/** Trénink zapsaný bez opakování (např. 2× 8-4-2-1) – série se poznají podle opakujícího se vzoru */
function inferSeries(out) {
  const ints = out.map((s, i) => s.type === "interval" && s.kind === "time" ? i : -1).filter(i => i >= 0);
  const d = ints.map(i => out[i].seconds);
  for (let p = 2; p <= d.length / 2; p++) {
    if (d.length % p || !d.every((x, k) => x === d[k % p])) continue;
    const reps = d.length / p;
    for (let r = 0; r < reps; r++) {
      const from = ints[r * p], to = r < reps - 1 ? ints[(r + 1) * p] - 1 : ints[ints.length - 1];
      for (let i = from; i <= to; i++) out[i].series = r + 1;
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
let library = store.get("library3", []);
let libState = library.length ? "cached" : "loading", lastLoad = 0;

function fromFile(path, sha, obj) {
  const parts = path.split("/");
  const sportDir = SPORTS[parts[1]] ? parts[1] : null;
  const w = parseJson(obj, sportDir);
  const type = parts.length >= 4 ? parts[2] : "Intervaly";
  return { path, sha, sport: w.sport, type, name: w.name, steps: w.steps, seriesCount: w.seriesCount };
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
    store.set("library3", library);
    lastLoad = Date.now();
    libState = "ok";
  } catch (e) {
    libState = library.length ? "offline" : "error";
  }
  refresh();
}
const workoutsOf = sport => library.filter(w => w.sport === sport);
function typesOf(sport) {
  const used = [...new Set(workoutsOf(sport).map(w => w.type))];
  return [...DEFAULT_TYPES, ...used.filter(t => !DEFAULT_TYPES.includes(t)).sort((a, b) => a.localeCompare(b, "cs"))];
}
function workoutMeta(w) {
  const total = w.steps.reduce((a, s) => a + estSec(s, w.sport), 0);
  return "≈ " + Math.round(total / 60) + " min" + (w.seriesCount ? " · " + w.seriesCount + " " + plural(w.seriesCount, "série", "série", "sérií") : "");
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
      b.addEventListener("click", () => go("manage", { sport }));
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
  if (w.seriesCount) f.push([w.seriesCount, plural(w.seriesCount, "série", "série", "sérií")]);
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
    if (s.series && s.series !== lastS) pl.insertAdjacentHTML("beforeend", `<li class="sh">${s.series}. série</li>`);
    if (!s.series && lastS > 0) pl.insertAdjacentHTML("beforeend", `<li class="sh">Závěr</li>`);
    lastS = s.series || 0;
    const kind = indoor && s.kind === "distance" ? "open" : s.kind;
    const v = kind === "distance" ? km(s.meters) : kind === "open" ? "volně" : fmt(s.seconds);
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
  return s.name + (s.kind === "distance" ? ". " + km(s.meters) : s.kind === "open" ? ". Až budeš hotový, ťukni na Úsek hotový" : "");
}
function enterStep(i, startAt) {
  idx = i; flags = { beeped: {} };
  stepStartElapsed = elapsedNow() - (Date.now() - startAt);
  stepDist = 0; stepFixes = 0; stepMaxGap = 0; lastFixT = startAt;
  const s = cur();
  if (s.kind === "time") stepEndsAt = startAt + s.seconds * 1000;
  if (s.type === "interval") hideRpe();
  const c = $("clock"); c.classList.remove("tick"); void c.offsetWidth; c.classList.add("tick");
}
function leaveStep(natural, endT) {
  const s = cur();
  const sec = natural && s.kind === "time" ? s.seconds : (elapsedNow() - (Date.now() - endT) - stepStartElapsed) / 1000;
  const gapEnd = Math.max(stepMaxGap, endT - lastFixT);
  results.push({ name: s.name, type: s.type, series: s.series || 0, plan: s.kind === "time" ? s.seconds : null,
                 sec: Math.round(sec), m: Math.round(stepDist), ok: !ctx.indoor && stepFixes >= 3 && gapEnd <= 15000 });
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
  say(spoken(cur()) + (pendingRpe ? ". Ohodnoť sérii." : "."));
  if (pendingRpe) { showRpe(pendingRpe); pendingRpe = null; }
}
function startWorkout(w) {
  if (runActive()) return;
  unlockAudio();
  clearTimeout(toastT); $("toast").hidden = true;
  const indoor = w.sport === "kolo" && store.get("bikeEnv", "out") === "in";
  ctx = { sport: w.sport, indoor, path: w.path, name: cleanTitle(w.name), seriesCount: w.seriesCount };
  workout = w.steps.map(s => indoor && s.kind === "distance" ? { ...s, kind: "open" } : { ...s });
  results = []; rpe = {}; pendingRpe = null; elapsedMs = 0; idx = 0; skippedNote = ""; resumedAt = Date.now();
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
    sport: ctx.sport, indoor: ctx.indoor, workout: ctx.path, name: ctx.name,
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
    stepDist += d;
  }
  lastPt = pt;
  const s = cur();
  if (s.kind === "distance" && stepDist >= s.meters) { if (goNext(Date.now(), true)) announceStep(); }
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
  $("seriesLabel").textContent = s.series ? `Série ${s.series} z ${ctx.seriesCount}` : idx === 0 ? "Začátek" : "Závěr";
  $("totalLabel").textContent = fmt(elapsedNow() / 1000);
  const c = $("clock"), stepSec = (elapsedNow() - stepStartElapsed) / 1000;
  let prog = 0;
  if (s.kind === "time") { const r = remainingMs(); c.textContent = fmt(Math.ceil(r / 1000)); prog = 1 - r / (s.seconds * 1000); }
  else if (s.kind === "open") { c.textContent = fmt(stepSec); }
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
  if (skippedNote) live = skippedNote;
  if (runState === "paused") live = "Ťukni na ▶ a pokračuj";
  $("live").textContent = live;
  const n = workout[idx + 1];
  $("nextName").textContent = n ? n.name : "Cíl";
  $("nextVal").textContent = n ? (n.kind === "distance" ? km(n.meters) : n.kind === "open" ? "volně" : fmt(n.seconds)) : "";
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
function showRpe(series) { rpeFor = series; $("rpeTitle").textContent = `Jak těžká byla ${series}. série?`; $("rpeSheet").hidden = false; $("rpeScrim").hidden = false; }
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
  if (keys0.length) st.push([keys0.length, plural(keys0.length, "série", "série", "sérií")]);
  $("dStats").innerHTML = st.map(([a, b]) => `<div class="fact"><b class="num">${esc(a)}</b><span>${esc(b)}</span></div>`).join("");
  refreshSync();

  const val = x => x.ok ? metric(x.sec, x.m, r.sport) : null;
  const bySer = {};
  r.results.forEach(x => { if (x.series && x.type === "interval") (bySer[x.series] = bySer[x.series] || []).push(x); });
  const keys = Object.keys(bySer).map(Number).sort((a, b) => a - b);
  const cols = r.indoor ? 0 : keys.length ? Math.max(...keys.map(k => bySer[k].length)) : 0;
  const hasRpe = keys.some(k => r.rpe && r.rpe[k]);
  if (keys.length && (cols || hasRpe)) {
    $("seriesTitle").textContent = r.indoor ? "Pocit v sériích" : sp.metric === "speed" ? "Rychlost v sériích, km/h" : "Tempo v sériích, min/km";
    const ref = bySer[keys[0]];
    const g = $("seriesGrid");
    g.style.gridTemplateColumns = `auto repeat(${cols},minmax(0,1fr))${hasRpe ? " auto" : ""}`;
    let h = '<div class="hd rl">Série</div>';
    for (let c = 0; c < cols; c++) { const x = ref[c] || bySer[keys.find(k => bySer[k][c])][c]; h += `<div class="hd">${esc(x.plan ? durLabel(x.plan) : x.name)}</div>`; }
    if (hasRpe) h += '<div class="hd">Pocit</div>';
    keys.forEach(k => {
      h += `<div class="rl">${k}.</div>`;
      for (let c = 0; c < cols; c++) { const v = bySer[k][c] && val(bySer[k][c]); h += v != null ? `<div class="num">${metricTxt(v, r.sport, false)}</div>` : '<div class="num mut">—</div>'; }
      if (hasRpe) { const v = r.rpe[k]; h += v ? `<div><span class="pill num" style="--h:${rpeHue(v)}">${v}</span></div>` : '<div class="mut">—</div>'; }
    });
    g.innerHTML = h;
    $("seriesTbl").hidden = false;
  } else $("seriesTbl").hidden = true;

  const other = r.results.filter(x => !x.series && x.type !== "recovery");
  $("otherRows").innerHTML = other.map(x => { const v = val(x); return `<div class="r"><b>${esc(x.name)}</b><span class="num">${fmt(x.sec)}${x.ok && x.m ? " · " + km(x.m) : ""}</span><em class="num">${metricTxt(v, r.sport)}</em></div>`; }).join("");
  $("otherSec").hidden = !other.length;
  $("otherTitle").textContent = other.every(x => x.type === "warmup" || x.type === "cooldown") ? sp.names.warmup + " a " + sp.names.cooldown.toLowerCase() : "Úseky";

  // trenérský postřeh: první vs. poslední série
  const ins = $("insight");
  $("insightSec").hidden = true;
  if (keys.length >= 2 && !r.indoor) {
    const a = bySer[keys[0]], b = bySer[keys[keys.length - 1]];
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
    go("editor", { draft: { mode: "import", name: cleanTitle(p.name), sport: p.sport, type: "Intervaly", newType: "", imported: obj } });
  } catch (err) {
    toast("Soubor se nepodařilo načíst: " + err.message);
  }
});

/** Mazání s možností vrátit: soubor se z GitHubu smaže až po 6 s */
function deleteWorkout(w) {
  const pos = library.indexOf(w);
  library.splice(pos, 1); store.set("library3", library); renderManage();
  toast("Trénink smazán", () => { library.splice(pos, 0, w); store.set("library3", library); refresh(); }, async () => {
    try { await gh.del(w.path, w.sha, "Smazán trénink " + cleanTitle(w.name)); }
    catch (e) { library.splice(pos, 0, w); store.set("library3", library); refresh(); toast("Smazání se nepovedlo, zkus to znovu"); }
  });
}

// =========================================================
// Editor tréninku – naklikání nebo import z Garminu
// =========================================================
function newDraft(sport) {
  return {
    mode: "build", name: "", sport, type: "Intervaly", newType: "",
    warm: sport === "kolo" ? { kind: "time", value: "10:00" } : { kind: "distance", value: "1" }, reps: 4,
    rows: [{ work: "3:00", rest: "0:45" }, { work: "2:00", rest: "0:45" }, { work: "1:00", rest: "" }],
    between: "2:00", cool: { kind: "open", value: "" }, errors: {},
  };
}
/** Z naklikaného tréninku vytvoří soubor ve formátu Garmin, aby se dal číst stejně jako importované */
function buildGarmin(d) {
  const sp = SPORTS[d.sport];
  let order = 1;
  const mk = (key, cond, val) => ({ type: "ExecutableStepDTO", stepOrder: order++, stepType: { stepTypeKey: key }, endCondition: { conditionTypeKey: cond }, endConditionValue: val, description: null });
  const edge = (key, x) => {
    if (x.kind === "none") return null;
    if (x.kind === "time") return mk(key, "time", parseTime(x.value));
    if (x.kind === "distance") return mk(key, "distance", Math.round(parseFloat(String(x.value).replace(",", ".")) * 1000) || 1000);
    return mk(key, "lap.button", null);
  };
  const steps = [];
  const w = edge("warmup", d.warm); if (w) steps.push(w);
  const rows = d.rows.filter(r => parseTime(r.work) > 0);
  const inner = [];
  rows.forEach((r, i) => {
    inner.push(mk("interval", "time", parseTime(r.work)));
    const last = i === rows.length - 1;
    const rest = last ? (d.reps > 1 ? parseTime(d.between) : 0) : parseTime(r.rest);
    if (rest > 0) inner.push(mk("recovery", "time", rest));
  });
  if (d.reps > 1) steps.push({ type: "RepeatGroupDTO", stepOrder: order++, stepType: { stepTypeKey: "repeat" }, numberOfIterations: d.reps, skipLastRestStep: true, workoutSteps: inner });
  else steps.push(...inner);
  const c = edge("cooldown", d.cool); if (c) steps.push(c);
  return { workoutName: d.name.trim(), description: null, sportType: { sportTypeKey: sp.garmin }, workoutSegments: [{ segmentOrder: 1, sportType: { sportTypeKey: sp.garmin }, workoutSteps: steps }], createdWith: "TRImates" };
}
function draftObj(d) {
  if (d.mode === "import") { const o = JSON.parse(JSON.stringify(d.imported)); o.workoutName = d.name.trim(); o.sportType = { ...(o.sportType || {}), sportTypeKey: SPORTS[d.sport].garmin }; return o; }
  return buildGarmin(d);
}
function edgeField(d, key, label) {
  const x = d[key], sp = SPORTS[d.sport];
  const opts = [["none", "Žádný"], ["time", "Čas"], ["distance", "Vzdálenost"], ["open", "Volně"]];
  return `<div class="field"><span class="lbl">${label}</span>
    <div class="chips" data-edge="${key}">${opts.map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${x.kind === k}">${l}</button>`).join("")}</div>
    ${x.kind === "time" || x.kind === "distance" ? `<div class="inline"><input class="input small" data-edgeval="${key}" inputmode="decimal" value="${esc(x.value)}" aria-label="${label} – ${x.kind === "time" ? "minuty" : "kilometry"}"><span class="unit">${x.kind === "time" ? "min:s" : "km"}</span></div>` : ""}
    ${x.kind === "open" ? `<p class="help">Úsek ukončíš tlačítkem Úsek hotový</p>` : ""}
    ${x.kind === "distance" && sp ? `<p class="help">Venku se měří přes GPS, na trenažéru ho ukončíš tlačítkem</p>` : ""}</div>`;
}
function renderEditor() {
  const n = curNav(), d = n.draft;
  if (!d) return;
  $("edTitle").textContent = d.mode === "import" ? "Nahrát trénink" : "Nový trénink";
  const types = typesOf(d.sport);
  const e = d.errors || {};
  let h = `
   <div class="field"><label for="edName">Název</label>
    <input class="input" id="edName" value="${esc(d.name)}" placeholder="např. 4x (3-2-1 min)" autocomplete="off">
    ${e.name ? `<p class="error">${e.name}</p>` : ""}</div>
   <div class="field"><span class="lbl">Sport</span>
    <div class="seg" style="margin-top:0" data-sportseg>${Object.values(SPORTS).map(s => `<button data-s="${s.key}" aria-pressed="${d.sport === s.key}">${s.label}</button>`).join("")}</div></div>
   <div class="field"><span class="lbl">Typ tréninku</span>
    <div class="chips" data-typechips>${types.map(t => `<button class="chip" data-t="${esc(t)}" aria-pressed="${d.type === t}">${esc(t)}</button>`).join("")}<button class="chip" data-t="__new" aria-pressed="${d.type === "__new"}">Jiný…</button></div>
    ${d.type === "__new" ? `<input class="input" id="edNewType" style="margin-top:var(--s-xs)" value="${esc(d.newType)}" placeholder="Název nového typu" aria-label="Název nového typu">` : ""}
    ${e.type ? `<p class="error">${e.type}</p>` : ""}</div>`;
  if (d.mode === "build") {
    const sp = SPORTS[d.sport];
    h += edgeField(d, "warm", sp.names.warmup);
    h += `<div class="box"><span class="lbl">Série</span>
      <div class="field" style="margin-top:var(--s-s)"><span class="lbl" style="font-weight:400">Počet opakování</span>
       <div class="stepper"><button data-reps="-1" aria-label="Méně">−</button><output id="edReps">${d.reps}</output><button data-reps="1" aria-label="Více">+</button></div></div>
      <div class="bhead"><span></span><span>Interval</span><span>${sp.names.recovery === "Volně" ? "Volně" : "Meziklus"}</span><span></span></div>
      ${d.rows.map((r, i) => `<div class="brow"><span class="n">${i + 1}.</span>
        <input class="input" data-row="${i}" data-f="work" inputmode="decimal" value="${esc(r.work)}" aria-label="Interval ${i + 1}, min:s">
        ${i < d.rows.length - 1 ? `<input class="input" data-row="${i}" data-f="rest" inputmode="decimal" value="${esc(r.rest)}" aria-label="Pauza po intervalu ${i + 1}, min:s">` : `<span class="help" style="text-align:center">${d.reps > 1 ? "viz níže" : "—"}</span>`}
        <button class="iconbtn" data-del="${i}" aria-label="Odebrat úsek ${i + 1}">✕</button></div>`).join("")}
      <p class="help">Časy piš jako min:s, například 3:00 nebo 0:45</p>
      ${e.rows ? `<p class="error">${e.rows}</p>` : ""}
      <button class="btn-tertiary" id="edAddRow" style="margin-top:var(--s-xs)">Přidat úsek</button>
      ${d.reps > 1 ? `<div class="field"><label for="edBetween">Pauza mezi sériemi</label><div class="inline" style="margin-top:0"><input class="input small" id="edBetween" inputmode="decimal" value="${esc(d.between)}"><span class="unit">min:s</span></div></div>` : ""}
     </div>`;
    h += edgeField(d, "cool", sp.names.cooldown);
  }
  h += `<div class="preview"><div class="meta" id="edMeta"></div><div class="strip" id="edStrip" aria-hidden="true"></div></div>`;
  $("edBody").innerHTML = h;
  updatePreview();
}
function updatePreview() {
  const d = curNav().draft;
  try {
    const p = parseJson(draftObj({ ...d, name: d.name || "x" }), d.sport);
    $("edMeta").textContent = "Náhled · " + workoutMeta({ ...p, sport: d.sport }) + " · " + p.steps.length + " " + plural(p.steps.length, "krok", "kroky", "kroků");
    buildStrip($("edStrip"), p.steps, d.sport);
  } catch (e) { $("edMeta").textContent = "Přidej aspoň jeden interval"; $("edStrip").innerHTML = ""; }
}
$("edBody").addEventListener("input", e => {
  const d = curNav().draft, t = e.target;
  if (t.id === "edName") d.name = t.value;
  else if (t.id === "edNewType") d.newType = t.value;
  else if (t.id === "edBetween") d.between = t.value;
  else if (t.dataset.row) d.rows[+t.dataset.row][t.dataset.f] = t.value;
  else if (t.dataset.edgeval) d[t.dataset.edgeval].value = t.value;
  updatePreview();
});
$("edBody").addEventListener("click", e => {
  const d = curNav().draft, b = e.target.closest("button");
  if (!b) return;
  if (b.closest("[data-sportseg]")) d.sport = b.dataset.s;
  else if (b.closest("[data-typechips]")) d.type = b.dataset.t;
  else if (b.closest("[data-edge]")) {
    const key = b.closest("[data-edge]").dataset.edge;
    d[key] = { kind: b.dataset.k, value: b.dataset.k === "distance" ? "1" : b.dataset.k === "time" ? "10:00" : "" };
  }
  else if (b.dataset.reps) d.reps = Math.min(20, Math.max(1, d.reps + Number(b.dataset.reps)));
  else if (b.dataset.del) { d.rows.splice(+b.dataset.del, 1); if (!d.rows.length) d.rows.push({ work: "1:00", rest: "" }); }
  else if (b.id === "edAddRow") { const last = d.rows[d.rows.length - 1]; if (last && !last.rest) last.rest = "1:00"; d.rows.push({ work: "1:00", rest: "" }); }
  else return;
  renderEditor();
});
$("saveBtn").addEventListener("click", async () => {
  const d = curNav().draft;
  d.errors = {};
  const type = d.type === "__new" ? d.newType.trim() : d.type;
  if (!d.name.trim()) d.errors.name = "Zadej název tréninku";
  if (!type) d.errors.type = "Zadej název typu";
  else if (/[\/\\]/.test(type)) d.errors.type = "Název typu nesmí obsahovat lomítko";
  if (d.mode === "build" && !d.rows.some(r => parseTime(r.work) > 0)) d.errors.rows = "Přidej aspoň jeden interval s časem";
  if (Object.keys(d.errors).length) { renderEditor(); return; }
  const obj = draftObj(d);
  const text = JSON.stringify(obj, null, 2) + "\n";
  let base = `${CFG.dir}/${d.sport}/${type}/${slug(d.name)}`, path = base + ".json", i = 2;
  while (library.some(w => w.path === path)) path = `${base}-${i++}.json`;
  const btn = $("saveBtn");
  btn.textContent = "Ukládám…";
  try {
    const sha = await gh.put(path, text, null, "Nový trénink " + d.name.trim());
    library.push({ path, sha, ...fromFile(path, sha, obj) });
    store.set("library3", library);
    btn.textContent = "Uložit trénink";
    nav = [{ screen: "home" }, { screen: "list", sport: d.sport }];
    history.pushState({ n: 2 }, "");
    show();
    toast("Trénink uložen");
  } catch (e) {
    btn.textContent = "Uložit trénink";
    toast(e.status === 401 || e.status === 403 ? "GitHub odmítl token, zkontroluj ho v nastavení" : "Uložení se nepovedlo, zkontroluj připojení");
  }
});

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
