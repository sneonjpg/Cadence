/* Cadence UI. Plain JavaScript, no build step. */
(function () {
  "use strict";
  const TIER_ORDER = { active: 0, maintenance: 1, parked: 2 };
  const PRIO_LABEL = { 1: "P1 · Must do", 2: "P2 · Should do", 3: "P3 · Nice to do" };
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayStr = () => ymd(new Date());
  const longDay = s => parse(s).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
  const shortDay = s => parse(s).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });

  let tab = "today", selected = todayStr(), lastToday = todayStr();
  let confirmId = null, editV = null, confirmVRemove = null, pendingImport = null, settingsMsg = "";
  let coach = null;              // { text, status: "loading" | "ok" | "err" }
  let convo = [];                // messages sent to the API
  let chatLog = [];              // what the chat sheet shows
  let inflight = 0, chain = Promise.resolve();
  let sheetOpen = false, chatBox = null;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in (attrs || {})) {
      const v = attrs[k];
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const ventures = () => Store.getVentures();
  const vname = id => { const v = ventures().find(v => v.id === id); return v ? v.name : "Other"; };
  const tasks = () => Store.get().tasks;

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
  }

  /* ---------- Claude plumbing ---------- */
  function trimConvo() { while (convo.length > 12) convo.shift(); while (convo.length && convo[0].role !== "user") convo.shift(); }
  function ask(content) {
    const run = async () => {
      convo.push({ role: "user", content }); trimConvo();
      try { const text = await Claude.send(convo.slice()); convo.push({ role: "assistant", content: text }); return text; }
      catch (e) { convo.pop(); throw e; }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }
  function speak(event) {                       // automatic reaction as you work
    const c = Claude.cfg();
    if (!Claude.live() || !c.auto || inflight > 0) return;
    inflight++; coach = { text: "Claude is thinking…", status: "loading" }; render();
    ask(Claude.messageFor(event)).then(text => { coach = { text, status: "ok" }; chatLog.push({ who: "ai", text }); })
      .catch(e => { coach = { text: Claude.friendly(e), status: "err" }; })
      .finally(() => { inflight--; if (tab === "today") render(); });
  }

  /* ---------- sheets ---------- */
  function openSheet(build) {
    closeSheet(true);
    const scrim = h("div", { class: "scrim", onclick: e => { if (e.target === scrim) closeSheet(); } });
    const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" });
    sheet.append(h("div", { class: "grab" }));
    build(sheet);
    scrim.append(sheet); $("sheetRoot").append(scrim);
    document.body.classList.add("lock");
    if (!sheetOpen) { sheetOpen = true; try { history.pushState({ sheet: 1 }, ""); } catch (e) {} }
    const first = sheet.querySelector("input[type=text], textarea"); if (first && !matchMedia("(pointer: coarse)").matches) first.focus();
  }
  function closeSheet(silent) {
    $("sheetRoot").replaceChildren(); document.body.classList.remove("lock"); chatBox = null;
    if (sheetOpen && !silent) { sheetOpen = false; try { history.back(); } catch (e) {} }
  }
  window.addEventListener("popstate", () => { if (sheetOpen) { sheetOpen = false; closeSheet(true); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("sheetRoot").firstChild) closeSheet(); });

  function ventureOptions(sel, current) {
    const list = ventures().slice().sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
      .filter(v => v.tier !== "parked" || v.id === current);
    const s = h("select", { id: sel });
    list.forEach(v => s.append(h("option", { value: v.id }, v.name + (v.tier === "parked" ? " (parked)" : ""))));
    s.append(h("option", { value: "other" }, "Other"));
    if (current) s.value = current;
    return s;
  }
  const prioSelect = (id, cur) => {
    const s = h("select", { id }, [1, 2, 3].map(p => h("option", { value: p }, PRIO_LABEL[p]))); s.value = String(cur || 2); return s;
  };

  function openAdd() {
    openSheet(sheet => {
      const title = h("input", { type: "text", id: "aTitle", maxlength: "160", placeholder: "e.g. Send 5 outreach messages", autocomplete: "off" });
      const ven = ventureOptions("aVen"), pri = prioSelect("aPri", 2);
      const day = h("input", { type: "date", id: "aDay", value: selected, required: true });
      const status = h("p", { class: "status" });
      const form = h("form", { onsubmit: e => {
        e.preventDefault();
        const t = title.value.trim(); if (!t) { status.textContent = "Give the task a name first."; return; }
        const task = Store.addTask({ title: t, venture: ven.value, priority: Number(pri.value), day: day.value || selected });
        if (!task) return;
        selected = task.day; closeSheet(); toast("Added.");
        speak(`Added a task: "${task.title}" (P${task.priority}, ${vname(task.venture)}) for ${longDay(task.day)}.`);
      } },
        h("div", { class: "ghead" }, h("h2", null, "Add a task"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")),
        h("div", { class: "fields" },
          h("label", { class: "full", for: "aTitle" }, "Task", title),
          h("label", { for: "aVen" }, "Venture", ven), h("label", { for: "aPri" }, "Priority", pri),
          h("label", { class: "full", for: "aDay" }, "Day", day)),
        h("p", { class: "hint" }, "Parked ventures are hidden. Unpark one on the Ventures tab to plan tasks for it."),
        status, h("button", { class: "btn", type: "submit" }, "Add task"));
      sheet.append(form);
    });
  }

  function openEdit(id) {
    const t = tasks().find(x => x.id === id); if (!t) return;
    openSheet(sheet => {
      const title = h("textarea", { id: "eTitle", rows: "2", maxlength: "200" }); title.value = t.title;
      const ven = ventureOptions("eVen", t.venture), pri = prioSelect("ePri", t.priority);
      const day = h("input", { type: "date", id: "eDay", value: t.day, required: true });
      const rm = h("button", { type: "button", class: "link warn", onclick: () => {
        if (rm.dataset.armed) { Store.deleteTask(id); confirmId = null; closeSheet(); toast("Task removed."); }
        else { rm.dataset.armed = "1"; rm.textContent = "Tap again to remove"; }
      } }, "Remove task…");
      const form = h("form", { onsubmit: e => {
        e.preventDefault();
        const nt = title.value.trim(); if (!nt) return;
        Store.updateTask(id, { title: nt, venture: ven.value, priority: Number(pri.value), day: day.value || t.day });
        closeSheet(); toast("Saved.");
      } },
        h("div", { class: "ghead" }, h("h2", null, "Edit task"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")),
        h("div", { class: "fields" },
          h("label", { class: "full", for: "eTitle" }, "Task", title),
          h("label", { for: "eVen" }, "Venture", ven), h("label", { for: "ePri" }, "Priority", pri),
          h("label", { class: "full", for: "eDay" }, "Day", day)),
        h("div", { class: "row" }, h("button", { type: "button", class: "btn ghost", onclick: () => closeSheet() }, "Cancel"), h("button", { type: "submit", class: "btn" }, "Save")),
        h("div", { class: "row", style: "align-items:center;justify-content:space-between" },
          h("button", { type: "button", class: "link", onclick: () => { closeSheet(); openChat(`Help me get started on this task: "${t.title}" (${vname(t.venture)}). Break it into small steps and tell me the first one.`); } }, "Ask Claude about this task"),
          rm));
      sheet.append(form);
    });
  }

  function openChat(prefill) {
    const live = Claude.live();
    openSheet(sheet => {
      sheet.append(h("div", { class: "ghead" }, h("h2", null, "Claude"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")));
      if (!live) {
        sheet.append(
          h("p", null, "Cadence can send a summary of your day to Claude. It copies the summary and opens claude.ai, where you can keep talking. No setup needed."),
          h("a", { class: "btn", href: Claude.handoffUrl(prefill), target: "_blank", rel: "noopener", style: "text-align:center;text-decoration:none;display:block", onclick: () => { toast(Claude.copyHandoff(prefill) ? "Copied. Paste it if the chat opens empty." : "Opening Claude…"); } }, "Open in Claude"),
          h("p", { class: "hint" }, "Want Claude to answer inside Cadence as you tick tasks? Add your own API key under Backup → Claude."),
          h("button", { class: "link", type: "button", onclick: () => { closeSheet(); tab = "settings"; render(); } }, "Go to Claude settings"));
        return;
      }
      chatBox = h("div", { class: "chat", "aria-live": "polite" });
      const paint = () => {
        chatBox.replaceChildren();
        if (!chatLog.length) chatBox.append(h("p", { class: "hint" }, "Ask anything about today, or say “break down my P1s”. I can see your tasks and ventures."));
        chatLog.slice(-20).forEach(m => chatBox.append(h("div", { class: "msg " + (m.who === "me" ? "me" : "ai") + (m.err ? " err" : "") }, m.text)));
        chatBox.scrollTop = chatBox.scrollHeight;
      };
      paint();
      const input = h("input", { type: "text", id: "cIn", placeholder: "Message Claude", autocomplete: "off", "aria-label": "Message Claude" });
      const sendBtn = h("button", { class: "btn", type: "submit" }, "Send");
      const submit = async text => {
        text = (text || "").trim(); if (!text) return;
        input.value = ""; chatLog.push({ who: "me", text }); chatLog.push({ who: "ai", text: "…" }); paint(); sendBtn.disabled = true;
        const slot = chatLog.length - 1;
        try { const r = await ask(Claude.messageFor("The user says: " + text)); chatLog[slot] = { who: "ai", text: r }; coach = { text: r, status: "ok" }; }
        catch (e) { chatLog[slot] = { who: "ai", text: Claude.friendly(e), err: true }; }
        if (chatBox) paint(); sendBtn.disabled = false; if (tab === "today") render();
      };
      sheet.append(chatBox, h("form", { class: "composer", onsubmit: e => { e.preventDefault(); submit(input.value); } }, input, sendBtn));
      if (prefill) submit(prefill);
    });
  }

  /* ---------- Today ---------- */
  function weekStart(s) { const d = parse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }

  function taskRow(t, carried) {
    const cb = h("input", { type: "checkbox", id: "cb-" + t.id, "aria-label": "Mark done: " + t.title, onchange: () => toggle(t) });
    cb.checked = !!t.done;
    return h("div", { class: "task" + (t.done ? " done" : "") }, cb,
      h("div", { class: "body" },
        h("button", { type: "button", class: "title", onclick: () => openEdit(t.id), "aria-label": "Edit: " + t.title }, t.title),
        h("div", { class: "meta" },
          h("span", { class: "prio p" + t.priority }, PRIO_LABEL[t.priority]),
          carried ? h("span", { class: "muted" }, "From " + shortDay(t.day)) : null,
          carried ? h("button", { type: "button", class: "link", onclick: () => move(t) }, "Move to today") : null,
          confirmId === t.id ? h("button", { type: "button", class: "link warn", onclick: () => { confirmId = null; Store.deleteTask(t.id); } }, "Tap to remove") : null)),
      h("button", { type: "button", class: "x", "aria-label": "Remove " + t.title, onclick: () => { confirmId = confirmId === t.id ? null : t.id; render(); } }, "×"));
  }

  function toggle(t) {
    const nowDone = !t.done;
    Store.updateTask(t.id, { done: nowDone });
    if (nowDone) {
      const left = tasks().filter(x => x.day === t.day && !x.done).length;
      speak(`Ticked done: "${t.title}" (P${t.priority}, ${vname(t.venture)}).` + (left === 0 ? " That was the last open task for that day." : ` ${left} still open that day.`));
    }
  }
  function move(t) {
    Store.updateTask(t.id, { day: todayStr() });
    speak(`Moved a carried-over task to today: "${t.title}" (P${t.priority}, ${vname(t.venture)}), originally for ${shortDay(t.day)}.`);
  }

  function grouped(list) {
    const by = {}; list.forEach(t => (by[t.venture] = by[t.venture] || []).push(t));
    const rank = id => { const v = ventures().find(v => v.id === id); return v ? TIER_ORDER[v.tier] : 3; };
    return Object.keys(by).sort((a, b) => rank(a) - rank(b) || ventures().findIndex(v => v.id === a) - ventures().findIndex(v => v.id === b))
      .map(id => [id, by[id].sort((a, b) => (a.done - b.done) || (a.priority - b.priority) || a.title.localeCompare(b.title))]);
  }

  function coachCard() {
    if (Claude.live()) {
      const c = coach || { text: "Tick a task and I’ll respond. Or ask me anything about your day.", status: "ok" };
      return h("section", { class: "coach" + (c.status === "loading" ? " loading" : c.status === "err" ? " err" : ""), "aria-label": "Claude" },
        h("p", { class: "eyebrow" }, "Claude"), h("p", { class: "says" }, c.text),
        h("div", { class: "acts" }, h("button", { class: "link", type: "button", onclick: () => openChat() }, "Talk to Claude")));
    }
    return h("section", { class: "coach", "aria-label": "Claude" },
      h("p", { class: "eyebrow" }, "Claude"),
      h("p", { class: "says" }, "Want a second opinion on your day? I’ll send today’s plan to Claude."),
      h("div", { class: "acts" },
        h("button", { class: "link", type: "button", onclick: () => openChat() }, "Open today in Claude"),
        h("button", { class: "link", type: "button", onclick: () => { tab = "settings"; render(); } }, "Get live replies")));
  }

  function viewToday() {
    const t = todayStr(), list = tasks().filter(x => x.day === selected);
    const done = list.filter(x => x.done).length;
    const out = [];
    const eyebrow = selected === t ? "Today" : selected < t ? "Looking back" : "Looking ahead";
    const strip = h("div", { class: "days" });
    const start = weekStart(selected);
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const s = ymd(d), open = tasks().filter(x => x.day === s && !x.done).length;
      strip.append(h("button", { type: "button", class: "day" + (i >= 5 ? " weekend" : "") + (s === t ? " today" : ""), "aria-pressed": String(s === selected),
        "aria-label": longDay(s) + (open ? ", " + open + " open" : ""), onclick: () => { selected = s; render(); } },
        h("small", null, d.toLocaleDateString("en-ZA", { weekday: "short" })), h("b", null, d.getDate()), h("span", { class: "dot" }, open ? open + " open" : "")));
    }
    out.push(h("header", null,
      h("div", { class: "row", style: "justify-content:space-between;align-items:baseline" },
        h("p", { class: "eyebrow" }, eyebrow),
        selected !== t ? h("button", { class: "link", type: "button", style: "flex:none", onclick: () => { selected = t; render(); } }, "Back to today") : null),
      h("h1", null, longDay(selected)),
      h("div", { class: "meter" }, h("div", { class: "bar" }, h("i", { style: "width:" + (list.length ? done / list.length * 100 : 0) + "%" })), h("span", null, list.length ? done + " of " + list.length + " done" : "Nothing planned")),
      h("div", { class: "strip" },
        h("button", { class: "nav", type: "button", "aria-label": "Previous week", onclick: () => { const d = parse(selected); d.setDate(d.getDate() - 7); selected = ymd(d); render(); } }, "‹"),
        strip,
        h("button", { class: "nav", type: "button", "aria-label": "Next week", onclick: () => { const d = parse(selected); d.setDate(d.getDate() + 7); selected = ymd(d); render(); } }, "›"))));
    out.push(coachCard());
    const dow = parse(selected).getDay();
    if (dow === 0 || dow === 6) out.push(h("div", { class: "notice" }, "Weekend: time for you and your son. Only add something here if an idea really won’t wait."));
    if (selected === t) {
      const carried = tasks().filter(x => !x.done && x.day < t).sort((a, b) => a.priority - b.priority || a.day.localeCompare(b.day));
      if (carried.length) out.push(h("section", { class: "group" }, h("div", { class: "ghead" }, h("h2", null, "Carried over"), h("span", { class: "tier maintenance" }, carried.length + " open")), carried.map(x => taskRow(x, true))));
    }
    if (!list.length) out.push(h("div", { class: "empty" }, "Nothing planned for this day. Tap + to add a task, or ask Claude to plan it with you."));
    for (const [vid, items] of grouped(list)) {
      const v = ventures().find(x => x.id === vid);
      out.push(h("section", { class: "group" }, h("div", { class: "ghead" }, h("h2", null, vname(vid)), v ? h("span", { class: "tier " + v.tier }, v.tier) : null), items.map(x => taskRow(x, false))));
    }
    return out;
  }

  /* ---------- Ventures ---------- */
  function ventureEditor(v) {
    const isNew = !v;
    const name = h("input", { type: "text", id: "vName", maxlength: "60", value: v ? v.name : "" });
    const tier = h("select", { id: "vTier" }, ["active", "maintenance", "parked"].map(x => h("option", { value: x }, x[0].toUpperCase() + x.slice(1))));
    tier.value = v ? v.tier : "maintenance";
    const goal = h("textarea", { id: "vGoal", rows: "3", maxlength: "200" }); goal.value = v ? v.goal : "";
    const note = h("p", { class: "notice small" });
    const upd = () => {
      const n = ventures().filter(x => x.tier === "active" && (!v || x.id !== v.id)).length + (tier.value === "active" ? 1 : 0);
      note.textContent = n > 2 ? `That would make ${n} active ventures. One in, one out: park or downgrade another first.` : "One in, one out: keep two active at most so the week stays realistic.";
    };
    tier.addEventListener("change", upd); upd();
    const save = () => {
      const nm = name.value.trim(); if (!nm) { name.focus(); return; }
      if (isNew) Store.addVenture({ name: nm, tier: tier.value, goal: goal.value.trim() });
      else Store.setVentures(ventures().map(x => x.id === v.id ? Object.assign({}, x, { name: nm, tier: tier.value, goal: goal.value.trim() }) : x));
      editV = null; confirmVRemove = null; render();
    };
    return h("div", { class: "card" },
      h("div", { class: "ghead" }, h("h3", null, isNew ? "New venture" : "Edit venture"), h("button", { type: "button", class: "x", "aria-label": "Close editor", onclick: () => { editV = null; render(); } }, "×")),
      h("label", { for: "vName" }, "Name", name), h("label", { for: "vTier" }, "Tier", tier), h("label", { for: "vGoal" }, "Goal", goal), note,
      h("div", { class: "row" },
        isNew ? h("button", { class: "btn ghost", type: "button", onclick: () => { editV = null; render(); } }, "Cancel")
          : h("button", { class: "btn ghost", type: "button", onclick: () => {
              if (confirmVRemove === v.id) {
                Store.setVentures(ventures().filter(x => x.id !== v.id));
                Store.get().tasks.filter(t => t.venture === v.id).forEach(t => Store.updateTask(t.id, { venture: "other" }));
                editV = null; confirmVRemove = null; render(); toast("Venture removed. Its tasks moved to Other.");
              } else { confirmVRemove = v.id; render(); }
            } }, confirmVRemove === v.id ? "Tap to remove" : "Remove venture"),
        h("button", { class: "btn", type: "button", onclick: save }, "Save")));
  }

  function viewVentures() {
    const out = [h("header", null, h("p", { class: "eyebrow" }, "Your ventures"), h("h1", null, "Ventures"),
      h("p", { class: "hint" }, "Review every 4–6 weeks · one in, one out"))];
    const list = ventures().slice().sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
    const box = h("div", { class: "group", style: "gap:0" });
    for (const v of list) {
      if (editV === v.id) { box.append(h("div", { style: "padding:12px 0" }, ventureEditor(v))); continue; }
      box.append(h("div", { class: "vrow " + v.tier }, h("div", { class: "top" }, h("h3", null, v.name), h("span", { class: "tier " + v.tier }, v.tier)),
        h("p", null, v.goal || ""), h("div", null, h("button", { class: "link", type: "button", onclick: () => { editV = v.id; confirmVRemove = null; render(); } }, "Edit"))));
    }
    out.push(box);
    out.push(editV === "new" ? ventureEditor(null) : h("button", { class: "btn ghost", type: "button", onclick: () => { editV = "new"; render(); } }, "+ Add a venture"));
    return out;
  }

  /* ---------- Backup & Claude settings ---------- */
  async function exportNow() {
    const name = "cadence-backup-" + todayStr() + ".json";
    let dl = null;
    try { if (window.claude && window.claude.use) dl = await window.claude.use("downloads"); } catch (e) {}
    try {
      if (dl) {
        const r = await dl.save({ filename: name, data: Store.exportData() });
        settingsMsg = r && r.status === "saved" ? "Backup saved." : "Backup sent.";
      } else {
        const blob = new Blob([Store.exportData()], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: name });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        settingsMsg = "Backup saved to your Downloads folder.";
      }
      Store.setSettings({ lastExport: new Date().toISOString() });
    } catch (e) { settingsMsg = e && e.code === "declined" ? "Backup cancelled." : "Couldn’t save the backup. Try again."; }
    render();
  }

  function viewSettings() {
    const st = Store.get(), s = Store.getSettings(), c = Claude.cfg();
    const out = [h("header", null, h("p", { class: "eyebrow" }, "Keep it safe"), h("h1", null, "Backup & settings"))];
    const file = h("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: async e => {
      const f = e.target.files[0]; if (!f) return;
      try { pendingImport = Store.parseImport(await f.text()); settingsMsg = ""; } catch (err) { pendingImport = null; settingsMsg = err.message; }
      render();
    } });
    const last = s.lastExport ? new Date(s.lastExport).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "never";
    out.push(h("section", { class: "card" }, h("h3", null, window.CadenceSync && window.CadenceSync.on ? "Your data is backed up" : "Your data lives on this phone"),
      h("p", { class: "hint" }, window.CadenceSync && window.CadenceSync.on ? "Saved on this phone and in your Claude account, so it follows you across devices and survives clearing Chrome. Export is an extra copy." : "Clearing Chrome’s site data would wipe it. Export now and then, and keep the file in Drive or WhatsApp."),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: exportNow }, "Export"), h("button", { class: "btn ghost", type: "button", onclick: () => file.click() }, "Import"), file),
      h("p", { class: "status" }, settingsMsg || `Last export: ${last} · ${st.tasks.length} tasks, ${st.ventures.length} ventures`),
      Store.ok() ? null : h("p", { class: "notice small" }, "This browser isn’t letting Cadence save. Open it in Chrome (not a private tab).")));
    if (pendingImport) out.push(h("section", { class: "card" }, h("h3", null, "Replace everything?"),
      h("p", { class: "hint" }, `This file has ${pendingImport.tasks.length} tasks and ${pendingImport.ventures.length} ventures. Importing replaces what’s on this phone now.`),
      h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: () => { pendingImport = null; render(); } }, "Cancel"),
        h("button", { class: "btn", type: "button", onclick: () => { Store.replaceAll(pendingImport); pendingImport = null; settingsMsg = "Restored from backup."; render(); } }, "Replace"))));

    // Claude settings
    if (Claude.source() === "claude") {
      const auto = h("input", { type: "checkbox", id: "kAuto", onchange: () => { Store.setSettings({ auto: auto.checked }); } }); auto.checked = c.auto;
      out.push(h("section", { class: "card" }, h("h3", null, "Claude"),
        h("p", { class: "hint" }, "Connected through your Claude account. Nothing to set up. Replies use your normal Claude usage, and Chrome or the app may ask you to allow it the first time."),
        h("div", { class: "switch" }, h("label", { for: "kAuto", style: "color:var(--ink);font-size:16px" }, "Speak up as I work"), auto),
        h("p", { class: "small muted" }, "When this is on, Claude replies each time you tick, move or add a task.")));
    } else {
      const key = h("input", { type: "password", id: "kKey", placeholder: c.apiKey ? "Key saved. Paste a new one to replace" : "sk-ant-…", autocomplete: "off", spellcheck: "false" });
      const model = h("input", { type: "text", id: "kModel", value: c.model, autocomplete: "off" });
      const auto = h("input", { type: "checkbox", id: "kAuto" }); auto.checked = c.auto;
      const msg = h("p", { class: "status", role: "status" }, Claude.live() ? "Live replies are on." : "Live replies are off. Hand-off to claude.ai still works.");
      const saveCfg = () => {
        const patch = { model: model.value.trim() || Claude.DEFAULT_MODEL, auto: auto.checked };
        if (key.value.trim()) patch.apiKey = key.value.trim();
        Store.setSettings(patch); key.value = ""; msg.textContent = "Saved."; toast("Claude settings saved."); render();
      };
      out.push(h("section", { class: "card" }, h("h3", null, "Claude"),
        h("p", { class: "hint" }, "Optional live mode: Claude answers inside Cadence as you tick, move and add tasks, and you can chat with it. It uses your own Anthropic API key, billed to that key (a few cents a day at most). Set a spend limit in the Anthropic console."),
        h("label", { for: "kKey" }, "API key", key),
        h("label", { for: "kModel" }, "Model", model),
        h("div", { class: "switch" }, h("label", { for: "kAuto", style: "color:var(--ink);font-size:16px" }, "Speak up as I work"), auto),
        h("div", { class: "row" },
          h("button", { class: "btn", type: "button", onclick: saveCfg }, "Save"),
          h("button", { class: "btn ghost", type: "button", onclick: async e => {
            saveCfg(); e.target.disabled = true; msg.textContent = "Testing…";
            try { const r = await Claude.send([{ role: "user", content: "Reply with the single word: ready" }]); msg.textContent = "Connected. Claude said: " + r.slice(0, 60); }
            catch (err) { msg.textContent = Claude.friendly(err); }
            e.target.disabled = false;
          } }, "Save & test")),
        msg,
        c.apiKey ? h("button", { class: "link warn", type: "button", onclick: () => { Store.setSettings({ apiKey: "" }); toast("Key removed from this phone."); render(); } }, "Remove key from this phone") : null,
        h("p", { class: "small muted" }, "The key stays on this phone and is only sent to Anthropic. Backups never include it.")));
    }
    out.push(h("p", { class: "small muted", style: "text-align:center" }, "Cadence · v1"));
    return out;
  }

  /* ---------- shell ---------- */
  function render() {
    const view = $("view"); view.replaceChildren();
    const parts = tab === "today" ? viewToday() : tab === "ventures" ? viewVentures() : viewSettings();
    parts.forEach(p => view.append(p));
    $("fab").hidden = tab !== "today";
    document.querySelectorAll("#tabs button").forEach(b => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  }
  document.querySelectorAll("#tabs button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab; editV = null; window.scrollTo(0, 0); render(); }));
  $("fab").addEventListener("click", openAdd);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const t = todayStr();
    if (t !== lastToday) { if (selected === lastToday) selected = t; lastToday = t; render(); }
  });

  Store.subscribe(() => render());
  Claude.onReady(() => render());

  // Cloud sync (only inside a published Claude artifact, where the `db` capability exists).
  window.CadenceSync = { on: false };
  (async () => {
    try {
      if (!window.claude || !window.claude.use) return;
      const db = await window.claude.use("db"); if (!db) return;
      const ref = db.doc("cadence/state"); let timer = null;
      const push = s => { clearTimeout(timer); timer = setTimeout(() => { ref.set({ version: 1, updatedAt: s.updatedAt, ventures: s.ventures, tasks: s.tasks }).catch(() => {}); }, 400); };
      ref.onSnapshot(snap => {
        window.CadenceSync.on = true;
        let remote = null; try { remote = snap.exists ? JSON.parse(JSON.stringify(snap.data())) : null; } catch (e) {}
        const adopted = remote ? Store.adoptRemote(remote) : false;
        const cur = Store.get();
        // Local copy is newer than the saved one (or nothing is saved yet): save it. Own echoes are equal, so this never loops.
        if (!adopted && cur.updatedAt && (!remote || (Number(remote.updatedAt) || 0) < cur.updatedAt)) push(cur);
        if (tab === "settings") render();
      }, () => { window.CadenceSync.on = false; });
      Store.setSyncHook(push);
    } catch (e) {}
  })();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
  window.__cadence = { openChat }; // handy for debugging
})();
