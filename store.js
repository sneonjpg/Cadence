/* Cadence storage: local-first, one small wrapper over localStorage.
   Same operations the prototype used, so the UI code stays simple. */
window.Store = (function () {
  const KEY = "cadence.data.v1";
  const SET_KEY = "cadence.settings.v1"; // kept apart so exports never include the API key
  const subs = new Set();
  let state = null;
  let storageOk = true;
  const syncHooks = []; // cloud-sync listeners (artifact db in app.js, Make sync in sync.js)

  const clone = x => JSON.parse(JSON.stringify(x));
  const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function normalise(d) {
    const ventures = (d.ventures || []).map(v => ({
      id: String(v.id), name: String(v.name || "Untitled"),
      tier: ["active", "maintenance", "parked"].includes(v.tier) ? v.tier : "maintenance",
      goal: String(v.goal || "")
    }));
    const tasks = (d.tasks || []).map(t => ({
      id: String(t.id || uid()), title: String(t.title || "").slice(0, 200),
      venture: t.venture || "other",
      priority: [1, 2, 3].includes(Number(t.priority)) ? Number(t.priority) : 2,
      day: /^\d{4}-\d{2}-\d{2}$/.test(t.day) ? t.day : todayStr(),
      start: /^([01]\d|2[0-3]):[0-5]\d$/.test(t.start || "") ? t.start : "",
      mins: Math.max(0, Math.min(960, Math.round(Number(t.mins) || 0))),
      done: !!t.done, doneAt: t.done ? (t.doneAt || null) : null,
      needsApproval: !!t.needsApproval,
      decision: ["approved", "changes"].includes(t.decision) ? t.decision : "",
      decidedAt: t.decidedAt || null,
      changeNote: String(t.changeNote || "").slice(0, 500),
      createdAt: t.createdAt || new Date().toISOString()
    })).filter(t => t.title);
    const timeOk = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || "");
    const blocks = (((d.rhythm || {}).blocks) || []).map(b => ({
      id: String(b.id || uid()), label: String(b.label || "Block").slice(0, 40),
      kind: ["away", "work", "window"].includes(b.kind) ? b.kind : "away",
      start: timeOk(b.start) ? b.start : "09:00", end: timeOk(b.end) ? b.end : "10:00",
      days: Array.isArray(b.days) ? b.days.map(Number).filter(n => n >= 0 && n <= 6) : [1, 2, 3, 4, 5],
      optional: !!b.optional, flex: !!b.flex
    })).filter(b => b.end > b.start).slice(0, 24);
    const checkins = {};
    Object.keys(d.checkins || {}).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-14).forEach(k => {
      const c = d.checkins[k] || {}, ends = {}, on = {}, ok = {};
      Object.keys(c.ends || {}).forEach(id => { if (timeOk(c.ends[id])) ends[id] = c.ends[id]; });
      Object.keys(c.on || {}).forEach(id => { on[id] = !!c.on[id]; });
      Object.keys(c.ok || {}).forEach(id => { if (c.ok[id]) ok[String(id).slice(0, 60)] = true; });
      checkins[k] = { energy: ["low", "steady", "high"].includes(c.energy) ? c.energy : "", ends, on, ok, seen: !!c.seen, midSeen: !!c.midSeen };
    });
    return { version: 1, ventures, tasks, rhythm: { blocks }, checkins };
  }
  // A copy saved before rhythm existed has no rhythm; never let it wipe the one on this phone.
  function keepLocal(n, d) { if (state) { if (!d.rhythm) n.rhythm = state.rhythm; if (!d.checkins) n.checkins = state.checkins; } return n; }

  function todayStr() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; }
    catch (e) { storageOk = false; }
  }
  function notify() { subs.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } }); }
  function persist() {
    state.updatedAt = Date.now();
    write(); notify();
    syncHooks.forEach(fn => { try { fn(state); } catch (e) {} });
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const d = JSON.parse(raw); state = normalise(d); state.updatedAt = d.updatedAt || 0; return; }
    } catch (e) { storageOk = false; }
    // Pristine seed: updatedAt 0, so any copy saved elsewhere always wins over it.
    state = normalise(clone(window.CADENCE_SEED || { ventures: [], tasks: [] }));
    state.updatedAt = 0;
    write();
  }
  load();
  // Ask Chrome not to evict our data when the phone is low on space.
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  return {
    setSyncHook(fn) { syncHooks.push(fn); },
    addSyncHook(fn) { syncHooks.push(fn); },
    norm(d) { return normalise(d); },
    // Save a merged copy without triggering a sync hook (sync.js pushes it itself).
    applyMerge(d, ts) { state = keepLocal(normalise(d), d); state.updatedAt = ts || Date.now(); write(); notify(); },
    adoptRemote(d) {
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.ventures)) return false;
      if ((Number(d.updatedAt) || 0) <= (state.updatedAt || 0)) return false;
      state = keepLocal(normalise(d), d); state.updatedAt = Number(d.updatedAt);
      write(); notify(); return true;
    },
    subscribe(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); },
    get() { return state; },
    ok() { return storageOk; },
    todayStr,
    addTask(t) {
      const task = normalise({ tasks: [Object.assign({ id: uid(), done: false, createdAt: new Date().toISOString() }, t)] }).tasks[0];
      if (!task) return null;
      state.tasks.push(task); persist(); return task;
    },
    updateTask(id, fields) {
      const t = state.tasks.find(x => x.id === id); if (!t) return;
      Object.assign(t, fields);
      if ("done" in fields) t.doneAt = fields.done ? new Date().toISOString() : null;
      persist();
    },
    deleteTask(id) { state.tasks = state.tasks.filter(t => t.id !== id); persist(); },
    getRhythm() { return state.rhythm.blocks; },
    setRhythm(blocks) { state.rhythm = normalise({ rhythm: { blocks } }).rhythm; persist(); },
    getCheckin(day) { return state.checkins[day] || { energy: "", ends: {}, on: {}, ok: {}, seen: false, midSeen: false }; },
    setCheckin(day, patch) {
      const cur = state.checkins[day] || { energy: "", ends: {}, on: {}, ok: {}, seen: false, midSeen: false };
      const next = { energy: "energy" in patch ? patch.energy : cur.energy, ends: Object.assign({}, cur.ends, patch.ends || {}), on: Object.assign({}, cur.on, patch.on || {}), ok: Object.assign({}, cur.ok, patch.ok || {}), seen: "seen" in patch ? !!patch.seen : !!cur.seen, midSeen: "midSeen" in patch ? !!patch.midSeen : !!cur.midSeen };
      state.checkins[day] = next; state.checkins = normalise({ checkins: state.checkins }).checkins; persist();
    },
    getVentures() { return state.ventures; },
    setVentures(list) { state.ventures = normalise({ ventures: list }).ventures; persist(); },
    addVenture(v) { const id = "v" + Math.random().toString(36).slice(2, 7); state.ventures.push({ id, name: v.name, tier: v.tier, goal: v.goal || "" }); persist(); return id; },
    exportData() { return JSON.stringify({ app: "cadence", exportedAt: new Date().toISOString(), version: 1, ventures: state.ventures, tasks: state.tasks, rhythm: state.rhythm, checkins: state.checkins }, null, 2); },
    parseImport(text) {
      let d; try { d = JSON.parse(text); } catch (e) { throw new Error("That file isn’t valid JSON."); }
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.ventures)) throw new Error("That doesn’t look like a Cadence backup.");
      return normalise(d);
    },
    replaceAll(d) { state = keepLocal(normalise(d), d); persist(); },
    getSettings() { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch (e) { return {}; } },
    setSettings(patch) {
      const s = Object.assign(this.getSettings(), patch);
      try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    }
  };
})();
