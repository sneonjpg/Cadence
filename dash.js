/* Cadence dashboard pop-up: a floating panel that shows your own private dashboard page.
   The link is saved only on this phone (never in this repo). Open it, minimise it to a tab on the side, or close it. */
(function () {
  const KEY = "cadence.dash.v1";
  let st = { url: "", mode: "pill", side: "right" };           // mode: pill | open | min
  try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
  const okUrl = u => /^https:\/\/[a-z0-9.-]+\//i.test(u || "");

  // A setup link like .../Cadence/#dash=CODE sets the link once, then clears the address bar.
  try {
    const m = location.hash.match(/dash=([A-Za-z0-9_\-+/=%]+)/);
    if (m) {
      let t = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "=";
      const u = atob(t);
      if (okUrl(u)) { st.url = u; st.mode = "open"; save(); }
      history.replaceState(null, "", location.pathname + location.search);
    }
  } catch (e) {}

  const css = document.createElement("style");
  css.textContent = `
  #dash{position:fixed;z-index:8;font-family:inherit}
  body.gated #dash,body.splashing #dash{display:none}
  #dash .dpill{position:fixed;bottom:calc(96px + env(safe-area-inset-bottom));background:var(--gr);color:var(--bg);border:1px solid var(--gold,#C9A24A);border-radius:999px;padding:10px 16px;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.25)}
  #dash.r .dpill{right:max(12px,env(safe-area-inset-right))}#dash.l .dpill{left:max(12px,env(safe-area-inset-left))}
  #dash .dtab{position:fixed;top:50%;transform:translateY(-50%);background:var(--gr);color:var(--bg);border:1px solid var(--gold,#C9A24A);padding:14px 7px;font-size:13px;font-weight:600;writing-mode:vertical-rl;letter-spacing:.06em}
  #dash.r .dtab{right:0;border-radius:12px 0 0 12px;border-right:none}#dash.l .dtab{left:0;border-radius:0 12px 12px 0;border-left:none;writing-mode:vertical-lr}
  #dash .dpanel{position:fixed;bottom:calc(80px + env(safe-area-inset-bottom));width:min(94vw,440px);height:min(72vh,640px);background:var(--sf);border:1px solid var(--ln);border-radius:16px;box-shadow:0 10px 34px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}
  #dash.r .dpanel{right:max(8px,env(safe-area-inset-right))}#dash.l .dpanel{left:max(8px,env(safe-area-inset-left))}
  #dash .dbar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--ln);background:var(--bg)}
  #dash .dbar b{flex:1;font-size:14px}
  #dash .dbar button,#dash .dbar a{min-width:36px;height:36px;border:1px solid var(--ln);border-radius:10px;background:var(--sf);color:var(--gr);font-size:16px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;padding:0 8px}
  #dash iframe{flex:1;border:0;width:100%;background:#fff}
  #dash .dsetup{padding:16px;display:flex;flex-direction:column;gap:10px;font-size:14px;overflow-y:auto}
  #dash .dsetup input{font:inherit;padding:10px;border:1px solid var(--ln);border-radius:10px;background:var(--bg);color:var(--ink);width:100%}
  #dash .dsetup button{font:inherit;font-weight:600;padding:10px 14px;border-radius:10px;border:none;background:var(--gr);color:var(--bg);min-height:44px}
  `;
  document.head.appendChild(css);

  const root = document.createElement("div"); root.id = "dash"; document.body.appendChild(root);
  let frameUrl = "";
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => k.startsWith("on") ? n.addEventListener(k.slice(2), v) : n.setAttribute(k, v)); kids.forEach(c => n.append(c)); return n; };
  const set = patch => { Object.assign(st, patch); save(); draw(); };

  function draw() {
    root.className = st.side === "left" ? "l" : "r";
    root.textContent = "";
    if (st.mode === "pill") { root.append(el("button", { class: "dpill", type: "button", onclick: () => set({ mode: "open" }) }, "Dashboard")); return; }
    if (st.mode === "min") { root.append(el("button", { class: "dtab", type: "button", "aria-label": "Open dashboard", onclick: () => set({ mode: "open" }) }, "Dashboard")); return; }
    const bar = el("div", { class: "dbar" }, el("b", {}, "Dashboard"),
      st.url ? el("a", { href: st.url, target: "_blank", rel: "noopener", "aria-label": "Open in a new tab", title: "Open in a new tab" }, "↗") : "",
      el("button", { type: "button", "aria-label": "Move to the other side", title: "Move to the other side", onclick: () => set({ side: st.side === "right" ? "left" : "right" }) }, st.side === "right" ? "◀" : "▶"),
      el("button", { type: "button", "aria-label": "Minimise to the side", title: "Minimise to the side", onclick: () => set({ mode: "min" }) }, "–"),
      el("button", { type: "button", "aria-label": "Close", title: "Close", onclick: () => set({ mode: "pill" }) }, "×"));
    const panel = el("div", { class: "dpanel", role: "dialog", "aria-label": "Dashboard" }, bar);
    if (okUrl(st.url)) {
      panel.append(el("iframe", { src: st.url, title: "Dashboard", referrerpolicy: "no-referrer", allow: "microphone" }));
    } else {
      const inp = el("input", { type: "text", placeholder: "Paste your dashboard link (https://…)", autocomplete: "off", spellcheck: "false", "aria-label": "Dashboard link" });
      const msg = el("p", { class: "small muted" }, "");
      panel.append(el("div", { class: "dsetup" },
        el("p", {}, "Add the link to your private dashboard page. It is saved only on this phone."), inp,
        el("button", { type: "button", onclick: () => { const v = inp.value.trim(); if (okUrl(v)) set({ url: v }); else msg.textContent = "That doesn’t look like a web link."; } }, "Save link"), msg));
    }
    root.append(panel);
  }
  draw();
})();
