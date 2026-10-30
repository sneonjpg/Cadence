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
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(c => c != null && c !== false));
  const ventures = () => Store.getVentures();
  const vname = id => { const v = ventures().find(v => v.id === id); return v ? v.name : "Other"; };
  const tasks = () => Store.get().tasks;

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
  }
  window.__cadenceToast = msg => toast(msg);

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
    if (activeRec) { try { activeRec.stop(); } catch (e) {} activeRec = null; }
    $("sheetRoot").replaceChildren(); document.body.classList.remove("lock"); chatBox = null;
    if (sheetOpen && !silent) { sheetOpen = false; try { history.back(); } catch (e) {} }
  }
  window.addEventListener("popstate", () => { if (sheetOpen) { sheetOpen = false; closeSheet(true); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && $("sheetRoot").firstChild) closeSheet(); });

  const LEN_OPTS = [[0, "No length"], [15, "15 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"], [90, "1½ hours"], [120, "2 hours"], [180, "3 hours"], [240, "4 hours"]];
  const fmtMins = m => { m = Math.round(m || 0); if (!m) return ""; const hh = Math.floor(m / 60), mm = m % 60; return (hh ? hh + " h" : "") + (hh && mm ? " " : "") + (mm ? mm + " m" : ""); };
  const addMins = (hhmm, m) => { const p = hhmm.split(":").map(Number), t = (p[0] * 60 + p[1] + m) % 1440; return pad(Math.floor(t / 60)) + ":" + pad(t % 60); };
  const timeLabel = t => t.start ? (t.mins ? t.start + "–" + addMins(t.start, t.mins) + " · " + fmtMins(t.mins) : "From " + t.start) : (t.mins ? fmtMins(t.mins) : "");
  const isExample = t => /^s0[1-6]$/.test(t.id) && /^Example:/.test(t.title);
  const isFresh = () => Store.get().updatedAt === 0 && tasks().every(isExample);
  let activeRec = null, newCache = {};

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
    const s = h("select", { id }, cur ? null : h("option", { value: "" }, "Choose priority"), [1, 2, 3].map(p => h("option", { value: p }, PRIO_LABEL[p]))); s.value = cur ? String(cur) : ""; return s;
  };
  const lenSelect = (id, cur) => {
    const s = h("select", { id }, LEN_OPTS.map(o => h("option", { value: o[0] }, o[1])));
    cur = Number(cur) || 0;
    if (!LEN_OPTS.some(o => o[0] === cur)) s.append(h("option", { value: cur }, fmtMins(cur)));
    s.value = String(cur); return s;
  };
  // A task must live somewhere: pick an existing venture or name a new one on the spot.
  function homePicker(id, current) {
    const list = ventures().slice().sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]).filter(v => v.tier !== "parked");
    const sel = h("select", { id }, h("option", { value: "" }, "Choose where it belongs"));
    list.forEach(v => sel.append(h("option", { value: v.id }, v.name)));
    sel.append(h("option", { value: "__new" }, "+ Add a new one…"));
    const nm = h("input", { type: "text", maxlength: "60", placeholder: "Name it", autocomplete: "off", "aria-label": "Name of the new venture or division" }); nm.hidden = true;
    if (current && list.some(v => v.id === current)) sel.value = current;
    sel.addEventListener("change", () => { nm.hidden = sel.value !== "__new"; if (!nm.hidden && !matchMedia("(pointer: coarse)").matches) nm.focus(); });
    return {
      el: h("div", { class: "homepick" }, sel, nm), sel, nm,
      valid: () => !!sel.value && (sel.value !== "__new" || !!nm.value.trim()),
      resolve: () => {
        if (sel.value !== "__new") return sel.value;
        const key = nm.value.trim().toLowerCase();
        return newCache[key] || (newCache[key] = Store.addVenture({ name: nm.value.trim(), tier: "maintenance", goal: "" }));
      },
      onChange: fn => { sel.addEventListener("change", fn); nm.addEventListener("input", fn); }
    };
  }

  function openAdd() {
    openSheet(sheet => {
      const title = h("input", { type: "text", id: "aTitle", maxlength: "160", placeholder: "e.g. Send 5 outreach messages", autocomplete: "off" });
      const home = homePicker("aVen"), pri = prioSelect("aPri", null);
      const day = h("input", { type: "date", id: "aDay", value: selected, required: true });
      const st = h("input", { type: "time", id: "aStart" }), len = lenSelect("aLen", 0);
      const go = h("button", { class: "btn", type: "submit", disabled: true }, "Add task");
      const status = h("p", { class: "status" }, "A name, a priority and where it belongs are needed. The time is up to you.");
      const check = () => { go.disabled = !(title.value.trim() && pri.value && home.valid()); };
      title.addEventListener("input", check); pri.addEventListener("change", check); home.onChange(check);
      const form = h("form", { onsubmit: e => {
        e.preventDefault(); check(); if (go.disabled) return;
        newCache = {};
        const task = Store.addTask({ title: title.value.trim(), venture: home.resolve(), priority: Number(pri.value), day: day.value || selected, start: st.value, mins: Number(len.value) });
        if (!task) return;
        selected = task.day; closeSheet(); toast("Added.");
        speak(`Added a task: "${task.title}" (P${task.priority}, ${vname(task.venture)}) for ${longDay(task.day)}` + (timeLabel(task) ? `, ${timeLabel(task)}` : "") + ".");
      } },
        h("div", { class: "ghead" }, h("h2", null, "Add a task"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")),
        h("div", { class: "fields" },
          h("label", { class: "full", for: "aTitle" }, "Task (needed)", title),
          h("label", { for: "aPri" }, "Priority (needed)", pri),
          h("label", { for: "aVen" }, "Where it belongs (needed)", home.el),
          h("label", { class: "full", for: "aDay" }, "Day", day),
          h("label", { for: "aStart" }, "Start time (optional)", st), h("label", { for: "aLen" }, "How long (optional)", len)),
        status, go);
      sheet.append(form);
    });
  }

  function openEdit(id) {
    const t = tasks().find(x => x.id === id); if (!t) return;
    openSheet(sheet => {
      const title = h("textarea", { id: "eTitle", rows: "2", maxlength: "200" }); title.value = t.title;
      const ven = ventureOptions("eVen", t.venture), pri = prioSelect("ePri", t.priority);
      const day = h("input", { type: "date", id: "eDay", value: t.day, required: true });
      const st = h("input", { type: "time", id: "eStart", value: t.start || "" }), len = lenSelect("eLen", t.mins);
      const rm = h("button", { type: "button", class: "link warn", onclick: () => {
        if (rm.dataset.armed) { Store.deleteTask(id); confirmId = null; closeSheet(); toast("Task removed."); }
        else { rm.dataset.armed = "1"; rm.textContent = "Tap again to remove"; }
      } }, "Remove task…");
      const form = h("form", { onsubmit: e => {
        e.preventDefault();
        const nt = title.value.trim(); if (!nt) return;
        Store.updateTask(id, { title: nt, venture: ven.value, priority: Number(pri.value), day: day.value || t.day, start: st.value, mins: Number(len.value) });
        closeSheet(); toast("Saved.");
      } },
        h("div", { class: "ghead" }, h("h2", null, "Edit task"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")),
        h("div", { class: "fields" },
          h("label", { class: "full", for: "eTitle" }, "Task", title),
          h("label", { for: "eVen" }, "Venture", ven), h("label", { for: "ePri" }, "Priority", pri),
          h("label", { class: "full", for: "eDay" }, "Day", day),
          h("label", { for: "eStart" }, "Start time (optional)", st), h("label", { for: "eLen" }, "How long (optional)", len)),
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

  function taskRow(t, carried, showHome) {
    const cb = h("input", { type: "checkbox", id: "cb-" + t.id, "aria-label": "Mark done: " + t.title, onchange: () => toggle(t) });
    cb.checked = !!t.done;
    return h("div", { class: "task" + (t.done ? " done" : "") }, cb,
      h("div", { class: "body" },
        h("button", { type: "button", class: "title", onclick: () => openEdit(t.id), "aria-label": "Edit: " + t.title }, t.title),
        h("div", { class: "meta" },
          h("span", { class: "prio p" + t.priority }, PRIO_LABEL[t.priority]),
          timeLabel(t) ? h("span", { class: "when" }, timeLabel(t)) : null,
          showHome ? h("span", { class: "muted" }, vname(t.venture)) : null,
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
      h("p", { class: "says" }, "Want a second opinion on our day? I’ll send today’s plan to Claude."),
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
      h("div", { class: "meter" }, h("div", { class: "bar" }, h("i", { style: "width:" + (list.length ? done / list.length * 100 : 0) + "%" })), h("span", null, list.length ? done + " of " + list.length + " done" : "Nothing on the plan yet")),
      h("div", { class: "strip" },
        h("button", { class: "nav", type: "button", "aria-label": "Previous week", onclick: () => { const d = parse(selected); d.setDate(d.getDate() - 7); selected = ymd(d); render(); } }, "‹"),
        strip,
        h("button", { class: "nav", type: "button", "aria-label": "Next week", onclick: () => { const d = parse(selected); d.setDate(d.getDate() + 7); selected = ymd(d); render(); } }, "›"))));
    if (selected >= t) out.push(askCard());
    out.push(coachCard());
    const open = list.filter(x => !x.done), planned = open.reduce((n, x) => n + (x.mins || 0), 0);
    const cap = (Number(Store.getSettings().dayHours) || 6) * 60;
    if (planned || list.length) {
      out.push(h("section", { class: "plan" + (planned > cap ? " over" : "") },
        planned ? h("div", { class: "line" }, h("b", null, "Planned " + fmtMins(planned)), h("span", { class: "muted" }, " of " + fmtMins(cap))) : h("div", { class: "line muted" }, "No lengths set yet. Add one to a task and we’ll count the day."),
        planned ? h("div", { class: "bar" }, h("i", { style: "width:" + Math.min(100, planned / cap * 100) + "%" })) : null,
        planned ? h("p", { class: "hint" }, planned > cap ? "That’s " + fmtMins(planned - cap) + " more than we can fit. Move something or shorten it." : fmtMins(cap - planned) + " still free.") : null,
        h("button", { class: "link", type: "button", onclick: () => openReport(selected) }, "Day report")));
    }
    const dow = parse(selected).getDay();
    if (dow === 0 || dow === 6) out.push(h("div", { class: "notice" }, "Weekend: a lighter day. Only add something here if it really won’t wait."));
    if (selected === t) {
      const carried = tasks().filter(x => !x.done && x.day < t).sort((a, b) => a.priority - b.priority || a.day.localeCompare(b.day));
      if (carried.length) out.push(h("section", { class: "group" }, h("div", { class: "ghead" }, h("h2", null, "Carried over"), h("span", { class: "tier maintenance" }, carried.length + " open")), carried.map(x => taskRow(x, true))));
    }
    if (!list.length) out.push(h("div", { class: "empty" }, "Nothing on the plan for this day yet. Tap “What are we doing today?” to start, or + to add one task."));
    const timed = list.filter(x => x.start).sort((a, b) => a.start.localeCompare(b.start) || a.priority - b.priority);
    if (timed.length) out.push(h("section", { class: "group" }, h("div", { class: "ghead" }, h("h2", null, "Schedule"), h("span", { class: "tier active" }, timed.length + " timed")), timed.map(x => taskRow(x, false, true))));
    for (const [vid, items] of grouped(list.filter(x => !x.start))) {
      const v = ventures().find(x => x.id === vid);
      out.push(h("section", { class: "group" }, h("div", { class: "ghead" }, h("h2", null, vname(vid)), v ? h("span", { class: "tier " + v.tier }, v.tier) : null), items.map(x => taskRow(x, false))));
    }
    return out;
  }

  function askCard() {
    const t = todayStr();
    return h("button", { type: "button", class: "ask", onclick: () => openCapture(false) },
      h("span", { class: "q" }, selected === t ? "What are we doing today?" : "What are we doing on " + shortDay(selected) + "?"),
      h("span", { class: "s" }, "Say it or type it. We’ll turn it into tasks for you to approve."));
  }

  function openReport(day) {
    const list = tasks().filter(x => x.day === day && !x.done);
    const timed = list.filter(x => x.start).sort((a, b) => a.start.localeCompare(b.start));
    const rest = list.filter(x => !x.start).sort((a, b) => a.priority - b.priority);
    const planned = list.reduce((n, x) => n + (x.mins || 0), 0), cap = (Number(Store.getSettings().dayHours) || 6) * 60;
    const line = x => (timeLabel(x) ? timeLabel(x) + " · " : "") + x.title + " (" + vname(x.venture) + ", P" + x.priority + ")";
    const text = ["CDNC day report: " + longDay(day), "", planned ? "Planned " + fmtMins(planned) + " of " + fmtMins(cap) + (planned > cap ? ", over by " + fmtMins(planned - cap) : "") : "No lengths set.", ""]
      .concat(timed.length ? ["Schedule"].concat(timed.map(x => "• " + line(x)), [""]) : [], rest.length ? ["Still to place"].concat(rest.map(x => "• " + line(x))) : []).join("\n");
    openSheet(sheet => {
      const section = (title, arr) => arr.length ? h("section", { class: "group" }, h("div", { class: "ghead" }, h("h3", null, title)), arr.map(x => h("p", null, h("b", null, timeLabel(x) || "Any time"), " · " + x.title, h("span", { class: "muted" }, " · " + vname(x.venture) + " · P" + x.priority)))) : null;
      sheet.append(...[h("div", { class: "ghead" }, h("h2", null, "Day report"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")),
        h("p", { class: "hint" }, longDay(day) + (planned ? " · planned " + fmtMins(planned) + " of " + fmtMins(cap) : "")),
        list.length ? null : h("p", null, "Nothing open for this day."),
        section("Schedule", timed), section("Still to place", rest),
        h("div", { class: "row" }, h("button", { class: "btn ghost", type: "button", onclick: () => closeSheet() }, "Close"),
          h("button", { class: "btn", type: "button", onclick: e => { try { navigator.clipboard.writeText(text); e.target.textContent = "Copied"; } catch (err) { e.target.textContent = "Couldn’t copy"; } } }, "Copy report"))].filter(Boolean));
    });
  }

  /* ---- say it or type it: split what you said into proposed tasks ---- */
  function parseDay(text) {
    const out = [];
    const parts = String(text || "").replace(/\r/g, "\n").split(/\n+|;|\.\s+|,\s*|\s+and then\s+|\s+then\s+/i);
    parts.forEach(raw => {
      let s = raw.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, "").trim(); if (!s) return;
      let start = "", mins = 0, m;
      m = s.match(/\b(?:at|@)\s*(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?\b/i);
      if (m && (m[2] || m[3] || Number(m[1]) >= 7)) {
        let hh = Number(m[1]); const mm = Number(m[2] || 0);
        if (m[3]) { const pm = m[3].toLowerCase() === "pm"; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
        if (hh < 24 && mm < 60) { start = pad(hh) + ":" + pad(mm); s = s.replace(m[0], " "); }
      }
      m = s.match(/\bfor\s+(half an?|an?|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i) || s.match(/\b(\d+(?:\.\d+)?)\s*[- ]?\s*(hours?|hrs?|minutes?|mins?)\b/i);
      if (m) {
        const q = /half/i.test(m[1]) ? 0.5 : /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
        mins = Math.round(q * (/^h/i.test(m[2]) ? 60 : 1)); s = s.replace(m[0], " ");
      }
      let prev; do { prev = s; s = s.replace(/^(?:(?:ok|okay|so|today|tomorrow)\b[\s,]*)?(?:(?:i|we)(?:'m| am|'re| are)?\s+(?:going to|need to|have to|must|will|want to|should|gotta)|need to|have to|remember to|also|first|next|and)\b[\s,]*/i, ""); } while (s !== prev);
      s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/[\s,.-]+$/, "").trim();
      if (s.length < 2) return;
      out.push({ title: s.charAt(0).toUpperCase() + s.slice(1), start, mins });
    });
    return out;
  }

  function openCapture(first) {
    const pref = Store.getSettings().input || "both";
    openSheet(sheet => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const body = h("div", { class: "capbody" }); sheet.append(body);
      const ta = h("textarea", { id: "cText", rows: pref === "voice" ? "3" : "5", maxlength: "1500", placeholder: "Say or type it all in one go. For example: send the proposal at 10 for an hour, call the printer at 3pm, review the week." });
      const note = h("p", { class: "status", role: "status" }, "");
      let listening = false, baseText = "";
      const MIC = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V22M8.5 22h7"/></svg>';
      const mic = h("button", { type: "button", class: "mic" + (pref === "voice" ? " big" : ""), "aria-label": "Speak" });
      const setMic = on => { mic.innerHTML = MIC + '<span>' + (on ? "Listening… tap to stop" : "Tap to speak") + '</span>'; mic.classList.toggle("on", on); };
      setMic(false);
      const next = h("button", { class: "btn", type: "button", disabled: true }, "Next");
      const check = () => { next.disabled = !ta.value.trim(); };
      ta.addEventListener("input", check);
      let wantOn = false, fatal = false, quick = 0;
      const stopMic = () => { wantOn = false; if (activeRec) { try { activeRec.stop(); } catch (e) {} } };
      const begin = () => {
        const rec = new SR(); activeRec = rec; rec.lang = "en-ZA"; rec.interimResults = true; rec.continuous = true;
        const startedAt = Date.now(); let gotSpeech = false;
        baseText = ta.value.trim() ? ta.value.trim() + " " : "";
        rec.onresult = e => {
          gotSpeech = true; quick = 0;
          // Android Chrome can return each phrase as a growing copy of the last. Keep only the latest copy.
          const out = [];
          const norm = s => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
          for (let i = 0; i < e.results.length; i++) {
            const t = e.results[i][0].transcript.trim(); if (!t) continue;
            const prev = out.length ? out[out.length - 1] : "";
            const nt = norm(t), np = norm(prev);
            if (prev && nt.startsWith(np)) out[out.length - 1] = t;
            else if (prev && np.startsWith(nt)) { /* shorter older copy: keep the longer one */ }
            else out.push(t);
          }
          ta.value = baseText + out.join(" "); check();
        };
        rec.onerror = e => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") { fatal = true; note.textContent = "The microphone is blocked. Allow it in Chrome’s site settings, or type instead."; }
          else if (e.error === "no-speech" || e.error === "aborted") { /* normal pauses: we keep listening */ }
          else { fatal = true; note.textContent = "Voice stopped (" + e.error + "). Typing works fine."; }
        };
        rec.onend = () => {
          if (activeRec === rec) activeRec = null;
          // Chrome ends a session after every pause. While you haven't tapped stop, quietly start the next one.
          if (!gotSpeech && Date.now() - startedAt < 2500) quick++;
          if (wantOn && !fatal && quick < 3) { setTimeout(() => { if (wantOn && !activeRec) { try { begin(); } catch (e) { wantOn = false; listening = false; setMic(false); } } }, 120); return; }
          if (wantOn && quick >= 3) note.textContent = "I can’t hear anything. Tap the mic to try again, or type.";
          wantOn = false; listening = false; setMic(false);
        };
        rec.start();
      };
      mic.addEventListener("click", () => {
        if (listening) { stopMic(); return; }
        try { fatal = false; quick = 0; wantOn = true; begin(); listening = true; setMic(true); note.textContent = ""; }
        catch (e) { wantOn = false; note.textContent = "Voice isn’t available here. Typing works fine."; }
      });
      if (!SR) { mic.hidden = true; note.textContent = "Voice isn’t available in this browser. Typing works fine."; }

      const showInput = () => {
        fill(body, 
          h("div", { class: "ghead" }, h("h2", null, "What are we doing today?"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => { stopMic(); closeSheet(); } }, "×")),
          h("p", { class: "hint" }, "Tell me the lot, in your own words. Times and lengths are picked up too. You approve everything before it’s saved."),
          pref === "text" ? [ta, mic] : [mic, ta], note,
          h("div", { class: "row" }, next),
          h("button", { type: "button", class: "link", onclick: () => { stopMic(); closeSheet(); } }, "Not now, just show my plan"));
        if (pref === "text" && !matchMedia("(pointer: coarse)").matches) ta.focus();
      };
      next.addEventListener("click", () => { stopMic(); review(parseDay(ta.value)); });

      const review = proposals => {
        if (!proposals.length) proposals = [{ title: "", start: "", mins: 0 }];
        const fresh = isFresh();
        const dayIn = h("input", { type: "date", id: "rDay", value: selected });
        const allPri = prioSelect("rAllP", null), allHome = homePicker("rAllH");
        const rows = proposals.map((p, i) => {
          const r = { on: h("input", { type: "checkbox", checked: true, "aria-label": "Include" }), title: h("input", { type: "text", maxlength: "160", value: p.title, "aria-label": "Task name" }),
            pri: prioSelect("rP" + i, null), home: homePicker("rH" + i), st: h("input", { type: "time", value: p.start, "aria-label": "Start time" }), len: lenSelect("rL" + i, p.mins) };
          r.card = h("div", { class: "rowcard" },
            h("div", { class: "rtop" }, r.on, r.title),
            h("div", { class: "fields" }, h("label", null, "Priority", r.pri), h("label", null, "Where it belongs", r.home.el), h("label", null, "Start (optional)", r.st), h("label", null, "Length (optional)", r.len)));
          return r;
        });
        const go = h("button", { class: "btn", type: "button" }, "Add tasks");
        const validate = () => {
          const picked = rows.filter(r => r.on.checked);
          const ok = picked.length && picked.every(r => r.title.value.trim() && r.pri.value && r.home.valid());
          go.disabled = !ok; go.textContent = picked.length ? "Add " + picked.length + (picked.length === 1 ? " task" : " tasks") : "Add tasks";
          rows.forEach(r => r.card.classList.toggle("off", !r.on.checked));
        };
        rows.forEach(r => { r.on.addEventListener("change", validate); r.title.addEventListener("input", validate); r.pri.addEventListener("change", validate); r.home.onChange(validate); });
        allPri.addEventListener("change", () => { if (allPri.value) rows.forEach(r => { r.pri.value = allPri.value; }); validate(); });
        allHome.sel.addEventListener("change", () => { if (allHome.sel.value && allHome.sel.value !== "__new") rows.forEach(r => { r.home.sel.value = allHome.sel.value; r.home.nm.hidden = true; }); validate(); });
        go.addEventListener("click", () => {
          validate(); if (go.disabled) return;
          newCache = {}; const added = [];
          rows.filter(r => r.on.checked).forEach(r => {
            const t = Store.addTask({ title: r.title.value.trim(), venture: r.home.resolve(), priority: Number(r.pri.value), day: dayIn.value || selected, start: r.st.value, mins: Number(r.len.value) });
            if (t) added.push(t);
          });
          if (fresh) tasks().filter(isExample).forEach(x => Store.deleteTask(x.id));
          if (added.length) selected = added[0].day;
          closeSheet(); toast(added.length ? "Added " + added.length + ". That’s us sorted." : "Nothing added.");
          if (added.length) speak(`Added ${added.length} tasks for ${longDay(selected)}: ` + added.map(t => `"${t.title}" (P${t.priority}, ${vname(t.venture)}${timeLabel(t) ? ", " + timeLabel(t) : ""})`).join("; ") + ".");
        });
        fill(body, 
          h("div", { class: "ghead" }, h("h2", null, "Here’s what we heard"), h("button", { type: "button", class: "x", "aria-label": "Close", onclick: () => closeSheet() }, "×")),
          h("p", { class: "hint" }, "Check each one. Every task needs a priority and a place to belong. Untick anything that isn’t a task."),
          proposals.length > 1 ? h("div", { class: "rowcard all" }, h("div", { class: "fields" }, h("label", null, "Same priority for all", allPri), h("label", null, "Same place for all", allHome.el))) : null,
          h("label", null, "Day", dayIn), rows.map(r => r.card), go,
          h("button", { type: "button", class: "link", onclick: showInput }, "Back"));
        validate();
      };
      showInput();
    });
  }

  function showWelcome() {
    const s = Store.getSettings();
    if (s.welcomed || !isFresh()) return;
    const root = h("div", { id: "first" }); document.body.append(root);
    const done = () => { Store.setSettings({ welcomed: true }); root.remove(); };
    const stepInput = () => {
      const opt = (val, title, sub) => h("button", { type: "button", class: "opt", onclick: () => { Store.setSettings({ input: val }); stepGo(); } }, h("b", null, title), h("span", null, sub));
      root.replaceChildren(h("div", { class: "fbox" },
        h("div", { class: "eyebrow" }, "Welcome"), h("h1", null, "How do you like to tell CDNC things?"),
        h("p", { class: "hint" }, "You can change this any time in Settings."),
        opt("both", "Both", "Speak or type, whichever suits the moment"), opt("voice", "Voice first", "The microphone opens first; typing is one tap away"), opt("text", "Typing first", "The keyboard opens first; voice is one tap away"),
        h("button", { type: "button", class: "link", onclick: done }, "Not now, just show my plan")));
    };
    const stepGo = () => {
      root.replaceChildren(h("div", { class: "fbox" },
        h("div", { class: "eyebrow" }, "CDNC"),
        h("button", { type: "button", class: "ask big", onclick: () => { done(); openCapture(true); } }, h("span", { class: "q" }, "What are we doing today?"), h("span", { class: "s" }, "Tap, then say it or type it.")),
        h("button", { type: "button", class: "link", onclick: done }, "Not now, just show my plan")));
    };
    stepInput();
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


    out.push(h("section", { class: "card" }, h("h3", null, "How we plan"),
      (() => {
        const sel = h("select", { id: "sInput", onchange: () => { Store.setSettings({ input: sel.value }); toast("Saved."); } },
          [["both", "Both: speak or type"], ["voice", "Voice first"], ["text", "Typing first"]].map(o => h("option", { value: o[0] }, o[1]))); sel.value = s.input || "both";
        const hrs = h("input", { type: "number", id: "sHours", min: "1", max: "16", step: "0.5", value: String(s.dayHours || 6), onchange: () => { const v = Math.max(1, Math.min(16, Number(hrs.value) || 6)); Store.setSettings({ dayHours: v }); hrs.value = String(v); toast("Saved."); render(); } });
        return h("div", { class: "fields" }, h("label", { for: "sInput" }, "How I like to tell CDNC things", sel), h("label", { for: "sHours" }, "Hours we can plan in a day", hrs));
      })(),
      h("p", { class: "hint" }, "The day report warns you when the timed tasks add up to more than this.")));

    // Sync with Claude (Make): hidden in this version; the sync script is not loaded.
    if (window.Sync && !(window.claude && window.claude.use)) {
      const si = Sync.info(), ago = si.lastOk ? new Date(si.lastOk).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "";
      if (Sync.configured()) {
        const auto = h("input", { type: "checkbox", id: "sAuto", onchange: () => { Store.setSettings({ syncAuto: auto.checked }); render(); } }); auto.checked = si.auto;
        const used = si.opsUsed, pct = Math.min(100, Math.round(used / si.opsLimit * 100));
        out.push(h("section", { class: "card" }, h("h3", null, "Synced with Claude"),
          h("p", { class: "hint" }, "Your plan is mirrored to your Make account. Tell Claude in any chat to check Cadence and it reads your plan, and changes it makes show up here."),
          h("p", { class: "status", role: "status" }, si.status === "syncing" ? "Syncing…" : si.status === "error" ? si.message : (si.message || "Ready.") + (ago ? " Last sync " + ago + "." : "")),
          h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => Sync.now() }, "Sync now"),
            h("button", { class: "btn ghost", type: "button", onclick: () => { if (confirm("Stop syncing on this phone? Your plan stays here and in Make.")) { Sync.disconnect(); render(); } } }, "Disconnect")),
          h("div", { class: "switch" }, h("label", { for: "sAuto", style: "color:var(--ink);font-size:16px" }, "Sync automatically (up to 3 times a day)"), auto),
          h("p", { class: "small muted" }, `Free Make plan: about ${used} of ${si.opsLimit} operations used this period (estimate). Auto-sync runs at most 3 times a day; Sync now always works.` + (pct >= 80 ? " You’re close." : ""))));
      } else {
        const code = h("input", { type: "text", id: "sCode", placeholder: "Paste setup link or code", autocomplete: "off", spellcheck: "false" });
        const m = h("p", { class: "status", role: "status" }, "");
        out.push(h("section", { class: "card" }, h("h3", null, "Sync with Claude"),
          h("p", { class: "hint" }, "Connect Cadence to your Make account so Claude can read and update your plan from any chat, and your changes reach Claude. Open the setup link Claude gave you, or paste the code here."),
          h("label", { for: "sCode" }, "Setup code", code),
          h("button", { class: "btn", type: "button", onclick: () => { if (Sync.connect(code.value)) { render(); toast("Sync connected"); } else m.textContent = "That doesn’t look like a setup link or code."; } }, "Connect"),
          m));
      }
    }

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
    out.push(h("p", { class: "small muted", style: "text-align:center" }, "CDNC · build 10"));
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
  if (window.Sync) Sync.onChange(() => { if (tab === "settings") render(); });
  Claude.onReady(() => render());
  showWelcome();

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
