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
