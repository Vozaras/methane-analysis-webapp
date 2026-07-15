# Implementation & Handover Guide

## Context

The project shipped its designed UI. The interface was created in Claude Design (source
*Methane Detection - F.dc.html*) and **hand-ported** into this repo as a clean static site
(plain HTML/CSS/JS — no framework, no build, no design runtime). An earlier Streamlit
prototype and its Python pipeline were removed in this pass. Model inference is **mocked**,
behind a single clearly-marked seam, pending the real backend.

> History: earlier iterations of this repo were a Streamlit classifier (and, before that, a
> plume-detection scaffold). Both are superseded — the app is now the static front-end above.

## Current state (done)

- `index.html` + `app.js` reproduce design F: scan-line landing, the Study (Results / Data /
  Models / Scores, incl. the interactive architecture diagram and confusion matrix), and the
  Demo (Leaflet map capture, channel/scene picker, analyze → per-class results + threshold).
- Verified headless: every render path populates; the model selector, confusion matrix,
  channel routing, analyze flow, and threshold slider all behave correctly.

## Remaining work

### Phase 1 — Wire the real `/predict` backend
- **Action:** replace the body of `runAnalysis()` in [app.js](app.js) with a call to the
  inference endpoint:
  ```js
  const body = new FormData(); body.append('image', file);
  const res  = await fetch(API_URL + '/predict', { method: 'POST', body });
  const data = await res.json();  // { results:[{abbr,name,conf}], boxes:[{x,y,w,h,label}] }
  ```
  Store `data.results`, set `state.phase='done'`, and change `renderUpload()` /
  `computedResults()` to read those results instead of the hardcoded `RESULTS` array. Keep
  the six class abbreviations (R&T, CAFO, PROC, MINE, LNDFL, WWTP) aligned with the backend.
- **Verify:** capture from the map or pick a channel scene → real confidences render; the
  threshold slider still flips PRESENT/BELOW.

### Phase 2 — Real per-scene input & results
- The map **Capture & analyze** already builds a 720×720 USGS export URL (`captureMap`), and
  channels build ESRI scene URLs. Send the captured image bytes to `/predict` (fetch the
  export URL, POST the blob) rather than only using it for display.
- Surface detection `boxes` on the result image if/when the model returns them (the design
  reserves lime boxes for this).

### Phase 3 — Optional: zero-network build
- Self-host JetBrains Mono, Leaflet, and a set of sample scene images so the app runs with no
  external requests. Replace the Google Fonts / unpkg links and the `esri()` scene URLs with
  local assets.

## Verification quick-reference

```bash
python3 -m http.server 8000        # open http://localhost:8000/
node --check app.js                # syntax
grep -riE 'inversa|dclogic|<x-dc|react' index.html app.js   # must be empty
```
Drive the app: scroll the landing (scan line + rail advance); STUDY (open each accordion,
switch model chips, pick confusion-matrix classes); DEMO (pan the map → Capture & analyze →
results; move the threshold; pick channels + a scene → Analyze selection; Analyze another).

## Reference — model backend contract
`POST /predict` (multipart `image`) → `{ results:[{abbr,name,conf}], boxes:[{x,y,w,h,label}] }`,
six facility classes. See [CLAUDE.md](CLAUDE.md) and the `runAnalysis` seam in `app.js`.
