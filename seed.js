/* Starter plan for a brand-new install. Generic on purpose: replace or delete everything.
   Dates are relative to the day the app is first opened. */
(function () {
  const p = n => String(n).padStart(2, "0");
  const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };
  const mk = (id, title, venture, priority, off) => ({ id, title, venture, priority, day: day(off), done: false, doneAt: null, createdAt: new Date().toISOString() });
  window.CADENCE_SEED = {
    version: 1,
    ventures: [
      { id: "va", name: "Venture A", tier: "active", goal: "The one outcome you want this quarter" },
      { id: "vb", name: "Venture B", tier: "active", goal: "A second focus (keep to two active at most)" },
      { id: "vr", name: "Weekly routine", tier: "maintenance", goal: "A small, repeatable habit that keeps something ticking over" },
      { id: "vs", name: "Side project", tier: "maintenance", goal: "Something you look after in small steps" },
      { id: "vp", name: "Parked idea", tier: "parked", goal: "Restart when the time is right" }
    ],
    tasks: [
      mk("s01", "Example: choose the first thing to focus on", "va", 1, 0),
      mk("s02", "Example: write a one-page plan", "va", 2, 0),
      mk("s03", "Example: 20-minute weekly routine", "vr", 3, 0),
      mk("s04", "Example: send one follow-up message", "vb", 2, 1),
      mk("s05", "Example: review the week", "vs", 3, 3),
      mk("s06", "Example: a task you carried over from yesterday", "va", 2, -1)
    ]
  };
})();
