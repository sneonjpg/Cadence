/* Cadence ↔ Claude.
   Two ways to talk to Claude, both optional:
   1. Hand-off (free, no setup): builds a summary of your day, copies it and opens claude.ai.
   2. Live coach (needs your own Anthropic API key): Cadence calls Claude directly from your phone as you
      tick, move and add tasks, and you can chat with it inside the app. API use is billed to your key. */
window.Claude = (function () {
  const API = "https://api.anthropic.com/v1/messages";
  const DEFAULT_MODEL = "claude-haiku-5-5";

  const SYSTEM = [
    "You are Claude, the in-app coach inside Cadence, a personal daily planner on one person's phone.",
    "The user runs a day job plus a few side ventures, in tiers: active (max two, the focus), maintenance (small routine), parked (not now).",
    "Weekends are for rest by default; do not push work on Saturday or Sunday unless the person asks.",
    "You receive the current planner state and the latest thing the user just did. Reply in 1–3 short sentences, plain text, no markdown, no emoji.",
    "Be warm but brisk. After a task is ticked, acknowledge it and name the single best next open task (P1 first, active ventures first).",
    "Speak up only when it helps: too many P1s in a day, tasks carried over several days, work scheduled for a parked venture, more than two active ventures, an empty day.",
    "If the user asks a question or asks you to break a task down, answer fully but keep it tight and practical. Never invent tasks or ventures that are not in the state."
  ].join(" ");

  // Inside a published Claude artifact, the viewer's own Claude account answers (the `sample`
  // capability), so no API key is needed. Anywhere else, an optional API key works instead.
  let sampleFn = null;
  const readyFns = [];
  (async () => {
    try { if (window.claude && window.claude.use) sampleFn = await window.claude.use("sample"); } catch (e) { sampleFn = null; }
    readyFns.forEach(fn => { try { fn(); } catch (e) {} });
  })();
  const onReady = fn => { readyFns.push(fn); if (sampleFn) { try { fn(); } catch (e) {} } };

  const cfg = () => {
    const s = Store.getSettings();
    return { apiKey: s.apiKey || "", model: s.model || DEFAULT_MODEL, auto: s.auto !== false };
  };
  const source = () => sampleFn ? "claude" : cfg().apiKey ? "key" : "none";
  const live = () => source() !== "none";

  function fmtDay(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  }

  function snapshot() {
    const st = Store.get(), today = Store.todayStr();
    const vname = id => (st.ventures.find(v => v.id === id) || { name: "Other" }).name;
    const line = t => `- [${t.done ? "x" : " "}] P${t.priority} ${t.title} (${vname(t.venture)})`;
    const todays = st.tasks.filter(t => t.day === today);
    const carried = st.tasks.filter(t => !t.done && t.day < today);
    const week = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const p = n => String(n).padStart(2, "0");
      const s = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
      const n = st.tasks.filter(t => t.day === s && !t.done).length;
      if (n) week.push(`${fmtDay(s)}: ${n} open`);
    }
    return [
      "Today: " + new Date().toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
      "Ventures:", ...st.ventures.map(v => `- ${v.name} [${v.tier}] goal: ${v.goal || "none"}`),
      `Today's tasks (${todays.filter(t => t.done).length} of ${todays.length} done):`, ...(todays.length ? todays.map(line) : ["- none"]),
      "Carried over from earlier days:", ...(carried.length ? carried.map(t => line(t) + ` from ${fmtDay(t.day)}`) : ["- none"]),
      "Next 7 days: " + (week.length ? week.join("; ") : "nothing planned")
    ].join("\n");
  }

  function messageFor(event) { return "PLANNER STATE\n" + snapshot() + "\n\nWHAT JUST HAPPENED\n" + event; }

  async function send(messages) {
    if (sampleFn) {
      try {
        const turns = [{ role: "user", content: "STANDING INSTRUCTIONS (always follow): " + SYSTEM }].concat(messages);
        const r = await sampleFn(turns, { cache: false, modelTier: "quick" });
        return (r.text || "").trim();
      } catch (e) {
        const code = e && e.code;
        throw Object.assign(new Error((e && e.message) || "error"), {
          code: code === "not_granted" || code === "sampling_disabled" || code === "capability_disabled" ? "declined"
            : code === "rate_limited" ? "rate" : code === "session_expired" ? "session" : code === "upstream_error" ? "offline" : "api"
        });
      }
    }
    const c = cfg();
    if (!c.apiKey) throw Object.assign(new Error("no-key"), { code: "no-key" });
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-api-key": c.apiKey,
          "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({ model: c.model, max_tokens: 400, system: SYSTEM, messages })
      });
    } catch (e) { throw Object.assign(new Error("offline"), { code: "offline" }); }
    let body = null; try { body = await res.json(); } catch (e) {}
    if (!res.ok) {
      const msg = (body && body.error && body.error.message) || ("HTTP " + res.status);
      throw Object.assign(new Error(msg), { code: res.status === 401 ? "bad-key" : res.status === 429 ? "rate" : "api" });
    }
    return ((body.content || []).filter(b => b.type === "text").map(b => b.text).join("\n") || "").trim();
  }

  function friendly(e) {
    switch (e && e.code) {
      case "no-key": return "Add your API key in Settings to let Claude respond live.";
      case "offline": return "Can’t reach Claude right now (offline?). Your tasks are safe.";
      case "bad-key": return "Claude rejected the API key. Check it in Settings.";
      case "rate": return "Claude is busy or your usage limit is reached. Try again in a moment.";
      case "declined": return "Claude access was declined for this page. Allow it when asked to get replies.";
      case "session": return "Sign in to Claude again to get replies.";
      default: return "Claude couldn’t answer: " + ((e && e.message) || "unknown error");
    }
  }

  function handoffPrompt(focus) {
    return "I'm using my Cadence planner. Here's where I am. " + (focus || "Help me plan the rest of today and tell me what to do next.") +
      "\n\n" + snapshot();
  }
  function handoffUrl(focus) { return "https://claude.ai/new?q=" + encodeURIComponent(handoffPrompt(focus)); }
  function copyHandoff(focus) {
    try { if (navigator.clipboard) { navigator.clipboard.writeText(handoffPrompt(focus)).catch(() => {}); return true; } } catch (e) {}
    return false;
  }

  return { live, source, onReady, cfg, send, messageFor, snapshot, friendly, handoffUrl, copyHandoff, DEFAULT_MODEL };
})();
