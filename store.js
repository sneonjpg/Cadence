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
      createdAt: t.createdAt || new Date().toISOString()
    })).filter(t => t.title);
    return { version: 1, ventures, tasks };
  }

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
    applyMerge(d, ts) { state = normalise(d); state.updatedAt = ts || Date.now(); write(); notify(); },
    adoptRemote(d) {
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.ventures)) return false;
      if ((Number(d.updatedAt) || 0) <= (state.updatedAt || 0)) return false;
      state = normalise(d); state.updatedAt = Number(d.updatedAt);
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
    getVentures() { return state.ventures; },
    setVentures(list) { state.ventures = normalise({ ventures: list }).ventures; persist(); },
    addVenture(v) { const id = "v" + Math.random().toString(36).slice(2, 7); state.ventures.push({ id, name: v.name, tier: v.tier, goal: v.goal || "" }); persist(); return id; },
    exportData() { return JSON.stringify({ app: "cadence", exportedAt: new Date().toISOString(), version: 1, ventures: state.ventures, tasks: state.tasks }, null, 2); },
    parseImport(text) {
      let d; try { d = JSON.parse(text); } catch (e) { throw new Error("That file isn’t valid JSON."); }
      if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.ventures)) throw new Error("That doesn’t look like a Cadence backup.");
      return normalise(d);
    },
    replaceAll(d) { state = normalise(d); persist(); },
    getSettings() { try { return JSON.parse(localStorage.getItem(SET_KEY)) || {}; } catch (e) { return {}; } },
    setSettings(patch) {
      const s = Object.assign(this.getSettings(), patch);
      try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    }
  };
})();
