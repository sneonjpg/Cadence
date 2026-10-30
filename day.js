/* Cadence day rhythm: the fixed shape of your day (blocked time, work, venture windows).
   Pure logic, no screen code. Generic on purpose: nothing here is personal; each person sets their own blocks. */
window.Day = (function () {
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const KIND = { away: "Blocked", work: "Work", window: "Your time" };
  const toMin = s => { const p = String(s).split(":").map(Number); return p[0] * 60 + p[1]; };
  const hm = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const dowOf = ymd => { const p = ymd.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]).getDay(); };

  // Blocks that apply on a date, with that day's check-in applied (flexible end, optional windows switched on).
  function blocksFor(date) {
    const ci = Store.getCheckin(date), dow = dowOf(date);
    return Store.getRhythm().filter(b => b.days.includes(dow)).map(b => {
      let end = b.end;
      if (b.flex && ci.ends && ci.ends[b.id] && ci.ends[b.id] > b.start) end = ci.ends[b.id];
      const on = !b.optional || !!(ci.on && ci.on[b.id]);
      return Object.assign({}, b, { end, on, mins: toMin(end) - toMin(b.start), adjusted: end !== b.end });
    }).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }
  // Minutes we can put venture work into on that date.
  function capacity(date) { return blocksFor(date).filter(b => b.kind === "window" && b.on).reduce((n, b) => n + b.mins, 0); }
  const hasRhythm = () => Store.getRhythm().length > 0;
  // Blocks the person says change day to day, which the midday check asks about.
  const flexBlocks = date => blocksFor(date).filter(b => b.flex);
  // Times offered for "when does it end": every 30 minutes from half an hour after the start to 22:00.
  function endOptions(b) { const o = []; for (let m = toMin(b.start) + 30; m <= 22 * 60; m += 30) o.push(hm(m)); return o; }
  // Which window (if any) a timed task sits inside.
  function windowOf(date, t) { if (!t.start) return null; return blocksFor(date).find(b => b.kind === "window" && b.on && t.start >= b.start && t.start < b.end) || null; }
  // A plain-words summary a person can read back or paste elsewhere.
  function summary() {
    return Store.getRhythm().map(b => b.label + " " + b.start + "–" + b.end + " (" + KIND[b.kind] + (b.optional ? ", optional" : "") + (b.flex ? ", end varies" : "") + ") " + b.days.map(d => DOW[d]).join(" ")).join("\n");
  }
  // A short code that carries a whole rhythm between phones (or from Claude), so it never has to live in the code.
  function exportCode() { return "cdnc-day:" + btoa(unescape(encodeURIComponent(JSON.stringify(Store.getRhythm())))); }
  function parseCode(text) {
    const m = String(text || "").trim().replace(/\s+/g, "").match(/^cdnc-day:([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("That isn’t a day code. It starts with cdnc-day:");
    let list; try { list = JSON.parse(decodeURIComponent(escape(atob(m[1])))); } catch (e) { throw new Error("That code is damaged. Copy it again."); }
    if (!Array.isArray(list) || !list.length) throw new Error("That code has no blocks in it.");
    return list;
  }
  return { DOW, KIND, toMin, hm, blocksFor, capacity, hasRhythm, flexBlocks, endOptions, windowOf, summary, exportCode, parseCode };
})();
