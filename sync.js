/* Cadence <-> Claude sync.
   Your plan is mirrored to a small store in your own Make account (a webhook plus one data store).
   Claude, in any chat with your Make connector, reads and edits the same record, so changes flow both ways.
   Rules: at most 3 automatic syncs a day (on open, and when you leave after editing), plus "Sync now" any time.
   No timers, so Make's free 1,000 operations a month is never at risk. Changes are merged item by item (3-way). */
window.Sync = (function () {
  const BASE_KEY = "cadence.syncbase.v1";
  const OPS_PER_CALL = 3;      // webhook + data store + response
  const OPS_LIMIT = 1000, OPS_STOP = 950;
  const DAILY_AUTO = 3, FRESH_MS = 4 * 60 * 60 * 1000;
  const listeners = [];
  let dirty = false, status = "off", message = "", lastOk = 0, lastSync = 0, busy = false, again = false, timer = null;

  const cfg = () => {
    const s = Store.getSettings();
    return { url: s.syncUrl || "", key: s.syncKey || "", store: s.syncStore || "", auto: s.syncAuto !== false };
  };
  const configured = () => { const c = cfg(); return !!(c.url && c.key); };
  const set = (st, msg) => { status = st; message = msg || ""; listeners.forEach(fn => { try { fn(); } catch (e) {} }); };

  /* ---- usage estimate (Make resets on the 15th) ---- */
  function period() { const d = new Date(); if (d.getDate() < 15) d.setMonth(d.getMonth() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function opsUsed() { const o = Store.getSettings().syncOps; return o && o.p === period() ? o.n : 0; }
  function bump() { Store.setSettings({ syncOps: { p: period(), n: opsUsed() + OPS_PER_CALL } }); }

  const today = () => { const d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); };
  function autoUsed() { const a = Store.getSettings().syncAuto3; return a && a.d === today() ? a.n : 0; }
  function autoBump() { Store.setSettings({ syncAuto3: { d: today(), n: autoUsed() + 1 } }); }
  const autoOk = () => cfg().auto && autoUsed() < DAILY_AUTO && opsUsed() < OPS_STOP;

  /* ---- merge ---- */
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeList(b, l, r) {
    const idx = a => { const m = new Map(); (a || []).forEach(x => m.set(x.id, x)); return m; };
    const B = idx(b), L = idx(l), R = idx(r), out = [], seen = new Set();
    const ids = [...L.keys(), ...R.keys(), ...B.keys()];
    ids.forEach(id => {
      if (seen.has(id)) return; seen.add(id);
      const bb = B.get(id), ll = L.get(id), rr = R.get(id); let pick;
      if (!bb) pick = ll || rr;
      else {
        const lch = !ll || !eq(ll, bb), rch = !rr || !eq(rr, bb);
        if (!lch && !rch) pick = ll;
        else if (lch && !rch) pick = ll;
        else if (!lch && rch) pick = rr;
        else pick = ll || rr; // both changed: this phone wins; an edit beats a delete
      }
      if (pick) out.push(pick);
    });
    return out;
  }
  const content = d => ({ ventures: d.ventures, tasks: d.tasks });
  const loadBase = () => { try { return JSON.parse(localStorage.getItem(BASE_KEY)); } catch (e) { return null; } };
  const saveBase = d => { try { localStorage.setItem(BASE_KEY, JSON.stringify(content(d))); } catch (e) {} };

  /* ---- network (simple requests only, so the browser sends no preflight) ---- */
  async function req(c, opts) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 20000);
    bump();
    try { return await fetch(opts.url, Object.assign({ signal: ctl.signal, cache: "no-store" }, opts.init)); }
    finally { clearTimeout(t); }
  }
  async function fetchRemote(c) {
    const q = new URLSearchParams({ a: "get", k: c.key, _: String(Date.now()) });
    const res = await req(c, { url: c.url + (c.url.includes("?") ? "&" : "?") + q });
    if (res.status === 403) throw Object.assign(new Error("denied"), { code: "denied" });
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { code: "http" });
    const txt = (await res.text()).trim();
    if (!txt || txt === "Accepted") return null;
    let d; try { d = JSON.parse(txt); } catch (e) { throw Object.assign(new Error("bad data"), { code: "bad" }); }
    if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.ventures)) return null;
    return d;
  }
  async function pushRemote(c, d) {
    const body = new URLSearchParams({ a: "put", k: c.key, d: JSON.stringify({ version: 1, updatedAt: d.updatedAt, ventures: d.ventures, tasks: d.tasks }), t: String(d.updatedAt), by: "app" });
    const res = await req(c, { url: c.url, init: { method: "POST", body, keepalive: true } });
    if (res.status === 403) throw Object.assign(new Error("denied"), { code: "denied" });
    if (!res.ok) throw Object.assign(new Error("HTTP " + res.status), { code: "http" });
  }

  function friendly(e) {
    switch (e && e.code) {
      case "denied": return "Make refused the key. Reconnect with a fresh setup link.";
      case "bad": return "The saved plan in Make isn’t valid JSON. Ask Claude to repair it.";
      case "http": return "Make answered with an error (" + e.message + "). It may be out of free operations.";
      default: return "Can’t reach Make right now. Your changes are safe here and will sync later.";
    }
  }

  /* ---- the sync itself ---- */
  async function run(manual) {
    if (!configured()) return;
    if (busy) { again = true; return; }
    if (!manual && !autoOk()) return;
    if (!manual) autoBump();
    busy = true; dirty = false; clearTimeout(timer); set("syncing", "Syncing…");
    const c = cfg();
    try {
      const remote = await fetchRemote(c);
      const local = Store.get(), base = loadBase();
      let final = local, changedLocal = false, needPush = false;
      if (!remote) {
        needPush = true; // nothing saved yet: save this phone's plan
      } else if (!base && !(local.updatedAt > 0)) {
        // fresh install with the starter plan: take what's saved
        if (Store.adoptRemote(remote)) { final = Store.get(); changedLocal = true; }
      } else {
        const r = Store.norm(remote), l = Store.norm(local);
        const mv = mergeList(base && base.ventures, l.ventures, r.ventures);
        const mt = mergeList(base && base.tasks, l.tasks, r.tasks);
        const merged = { ventures: mv, tasks: mt };
        if (!eq(content(Store.norm(merged)), content(l))) { changedLocal = true; }
        if (!eq(content(Store.norm(merged)), content(r))) needPush = true;
        if (changedLocal) { Store.applyMerge(merged, Date.now()); }
        final = Store.get();
      }
      if (needPush) {
        if (!(final.updatedAt > 0)) { Store.applyMerge(content(final), Date.now()); final = Store.get(); }
        await pushRemote(c, final);
      }
      saveBase(final);
      lastOk = lastSync = Date.now();
      set("ok", changedLocal && remote ? "Updated from Claude." : "Up to date.");
      if (changedLocal && remote && window.__cadenceToast) window.__cadenceToast("Updated from Claude");
    } catch (e) {
      dirty = true; set("error", friendly(e));
    } finally {
      busy = false;
      if (again) { again = false; schedule(); }
    }
  }

  function schedule() { /* no timers: edits wait for the next open or leave */ }
  Store.addSyncHook(() => { if (!configured()) return; dirty = true; });

  /* ---- setup ---- */
  function parseCode(text) {
    let t = String(text || "").trim();
    const m = t.match(/sync=([A-Za-z0-9_\-+/=%]+)/); if (m) t = decodeURIComponent(m[1]);
    t = t.replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    let o; try { o = JSON.parse(atob(t)); } catch (e) { return null; }
    if (!o || typeof o.u !== "string" || !/^https:\/\/hook\.[a-z0-9.]*make\.com\//.test(o.u) || !o.k) return null;
    return { syncUrl: o.u, syncKey: String(o.k), syncStore: o.s ? String(o.s) : "" };
  }
  function connect(text) {
    const o = parseCode(text); if (!o) return false;
    Store.setSettings(Object.assign({ syncAuto: true }, o));
    set("idle", ""); run(true); return true;
  }
  function disconnect() { Store.setSettings({ syncUrl: "", syncKey: "", syncStore: "" }); try { localStorage.removeItem(BASE_KEY); } catch (e) {} clearTimeout(timer); set("off", ""); }

  // A setup link looks like https://…/Cadence/#sync=CODE. Read it once, then clear it from the address bar.
  try {
    if (/sync=/.test(location.hash)) {
      const ok = connect(location.hash);
      history.replaceState(null, "", location.pathname + location.search);
      if (ok) setTimeout(() => window.__cadenceToast && window.__cadenceToast("Sync connected"), 600);
    }
  } catch (e) {}

  // Sync when the app opens and when you come back to it; flush edits as you leave.
  document.addEventListener("visibilitychange", () => {
    if (!configured()) return;
    if (document.visibilityState === "visible") { if (Date.now() - lastSync > FRESH_MS) run(false); }
    else if (dirty && !busy) run(false);
  });
  if (configured()) { set("idle", ""); window.addEventListener("load", () => setTimeout(() => run(false), 400)); }

  return {
    configured, cfg, connect, disconnect, parseCode, now: () => run(true),
    onChange(fn) { listeners.push(fn); },
    info: () => ({ status, message, lastOk, opsUsed: opsUsed(), opsLimit: OPS_LIMIT, auto: cfg().auto, autoLeft: Math.max(0, DAILY_AUTO - autoUsed()), store: cfg().store })
  };
})();
