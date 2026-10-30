/* CDNC welcome: the "Get CDNC" page shown to people who open the link in a browser.
   Installed copies (and anyone who chose "try it in my browser") go straight into the app.
   Reads the device only to choose the right install steps. Nothing is sent anywhere. */
(function () {
  "use strict";
  var KEY = "cadence.entered";
  var gate = document.getElementById("gate");
  if (!gate) return;
  var ua = navigator.userAgent || "";
  var standalone = false;
  try { standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) {}
  var entered = false;
  try { entered = !!localStorage.getItem(KEY); } catch (e) {}
  var bypass = /[?&]app\b/.test(location.search);
  var prompt = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); prompt = e; });
  window.addEventListener("appinstalled", function () { prompt = null; if (!gate.hidden) panel("done"); });

  if (standalone || entered || bypass) return;     // straight into the app

  var isAndroid = /Android/i.test(ua);
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|TikTok|; wv\)|GSA\//i.test(ua);
  var isChrome = /Chrome\//.test(ua) && !/EdgA|Edg\/|OPR|SamsungBrowser|Firefox|DuckDuckGo|UCBrowser/.test(ua) && !inApp;
  var isSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) && !inApp;
  var base = location.origin + location.pathname.replace(/index\.html$/, "");

  function h(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
  function btn(label, cls, fn) { var b = h("button", cls, label); b.type = "button"; b.addEventListener("click", fn); return b; }
  function steps(list) { var ol = h("ol", "g-steps"); list.forEach(function (s) { ol.append(h("li", null, s)); }); return ol; }
  function enter() { try { localStorage.setItem(KEY, "1"); } catch (e) {} gate.hidden = true; document.body.classList.remove("gated"); }
  function copy(btnEl) {
    var done = function () { btnEl.textContent = "Link copied"; };
    try { navigator.clipboard.writeText(base).then(done, done); } catch (e) { done(); }
  }

  function logo() {
    var w = h("div", "g-logo"); w.append(h("div", "g-mark", "CDNC"), h("div", "g-tag", "Find your rhythm. Keep going.")); return w;
  }
  function panel(kind) {
    gate.replaceChildren();
    var box = h("div", "g-box"); box.append(logo());
    var main = h("div", "g-main");
    if (kind === "home") {
      main.append(btn("Get CDNC", "g-btn", function () { panel(device()); }),
        btn("Just try it in my browser", "g-link", enter));
    } else {
      var title = "", body = [];
      if (kind === "android-install") {
        title = "Install CDNC";
        body.push(h("p", null, "Tap Install and CDNC lands on your home screen like any other app."));
        body.push(btn("Install", "g-btn", function () {
          if (!prompt) { panel("android-manual"); return; }
          prompt.prompt(); prompt.userChoice.then(function (c) { prompt = null; if (c && c.outcome === "accepted") panel("done"); else panel("android-manual"); });
        }));
      } else if (kind === "android-manual") {
        title = "Add CDNC to your home screen";
        body.push(steps(["Tap the ⋮ menu at the top right of Chrome.", "Tap Install app (or Add to Home screen).", "Tap Install. CDNC appears with your other apps."]));
      } else if (kind === "android-other") {
        title = "Open this page in Chrome";
        body.push(h("p", null, "CDNC installs best from Chrome."));
        var a = h("a", "g-btn", "Open in Chrome"); a.href = "intent://" + location.host + location.pathname + "#Intent;scheme=https;package=com.android.chrome;end"; body.push(a);
        body.push(h("p", "g-small", "Or use your browser’s menu and choose Add to Home screen."));
      } else if (kind === "inapp") {
        title = "Open this in your browser first";
        body.push(h("p", null, "This page is open inside another app, which can’t install CDNC."));
        body.push(steps([isIOS ? "Tap the share or ••• button." : "Tap the ⋮ or ••• menu.", isIOS ? "Choose Open in Safari." : "Choose Open in Chrome (or Open in browser).", "Then tap Get CDNC again."]));
        var c = btn("Copy link", "g-link", function () { copy(c); }); body.push(c);
      } else if (kind === "ios") {
        title = "Add CDNC to your home screen";
        body.push(steps(["Tap the Share button at the bottom of Safari (a square with an arrow).", "Scroll down and tap Add to Home Screen.", "Tap Add. CDNC appears with your other apps."]));
      } else if (kind === "ios-other") {
        title = "Open this page in Safari";
        body.push(h("p", null, "On iPhone, apps install from Safari. Copy the link, open Safari, paste it, then tap Get CDNC."));
        var c2 = btn("Copy link", "g-btn", function () { copy(c2); }); body.push(c2);
      } else if (kind === "desktop") {
        title = "Scan with your phone";
        body.push(h("p", null, "Point your phone’s camera at this code to open CDNC there, then tap Get CDNC."));
        var img = h("img", "g-qr"); img.src = "icons/qr.svg"; img.alt = "QR code for the CDNC link"; img.width = 200; img.height = 200; body.push(img);
        body.push(h("p", "g-small", base));
      } else if (kind === "done") {
        title = "CDNC is installed";
        body.push(h("p", null, "Open it from your home screen. This page won’t come back."));
      }
      main.append(h("h2", "g-h", title));
      body.forEach(function (n) { main.append(n); });
      main.append(btn("Open in browser instead", "g-link", enter), btn("Back", "g-link", function () { panel("home"); }));
    }
    box.append(main); gate.append(box);
  }
  function device() {
    if (isAndroid) { if (inApp) return "inapp"; if (!isChrome) return "android-other"; return prompt ? "android-install" : "android-manual"; }
    if (isIOS) { if (inApp) return "inapp"; return isSafari ? "ios" : "ios-other"; }
    return "desktop";
  }
  document.body.classList.add("gated");
  gate.hidden = false; panel("home");
  window.__cdncGate = { panel: panel, device: device };
})();
