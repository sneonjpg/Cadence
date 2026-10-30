# Cadence

A calm daily planner (tasks + ventures) with Claude beside you. Plain HTML/CSS/JS, no build step, works offline.

## Run it
- Needs to be served over **https** (or localhost) to install as an app and work offline.
- Upload this whole folder to any free static host (Netlify Drop, Cloudflare Pages, GitHub Pages) and open the URL in Chrome on Android.
- Chrome menu (⋮) → **Install app**.

## Claude
- Free: "Open today in Claude" copies your day and opens claude.ai.
- Live: Backup tab → Claude → paste your own Anthropic API key. Cadence then responds as you tick, move and add tasks. Key stays on the phone and is never exported.

## Files
index.html · styles.css · app.js · store.js · claude.js · seed.js (your tasks and ventures as of 28 Oct 2026) · sw.js · manifest.webmanifest · icons/

Data is stored in the browser (localStorage). Use **Backup → Export** regularly.


## Update 2 (in progress on the update-2-wip branch)
- Opening the link in a browser shows a "Get CDNC" page first. It reads the device and shows the right install steps (Android Chrome, other Android browsers, iPhone, computer with a QR code). Installed copies skip it.
- One-second logo splash on open.
- "What are we doing today?" opens say-it-or-type-it capture. What you say is split into proposed tasks you approve.
- Every task needs a name, a priority and a place it belongs. Day, start time and length are optional; Today shows a schedule, a planned-time bar and a day report.
- First run (blank starter plan only) asks how you like to give input: both, voice first or typing first.
- Cloud sync is not loaded in this version (sync.js stays in the repo, switched off).
- The QR code image (icons/qr.svg) points at https://sneonjpg.github.io/Cadence/. Regenerate it if the link changes.
