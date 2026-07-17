# CLAUDE.md — methane-analysis-webapp

Project context for Claude Code.

## What this is

A **static single-page web app** (plain HTML/CSS/JS — no framework, no build) for
methane-source facility mapping, based on Stanford's **METER-ML** benchmark. Two halves: a
**Study** (dataset, seven model experiments, scores) and a **Demo** (map/scene → per-class
confidence across six facility classes: R&T, CAFO, PROC, MINE, LNDFL, WWTP).

The UI was designed in Claude Design (source *Methane Detection - H.dc.html*) and
**hand-ported** to this repo — the Claude Design authoring runtime (`<x-dc>`, `support.js`,
React) was removed and its `DCLogic` component reimplemented in vanilla JS. (In the H source
the logic already lives in a vanilla `app-h.js` that the `.dc.html` just loads; the port is
`app-h.js` → `app.js` with the design-runtime boot hook swapped for a `DOMContentLoaded` boot.)

## Run

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
```
No build step. Deploy `index.html` + `app.js` to any static host.

## Architecture

- **[index.html](index.html)** — static chrome (nav, scan-line hero, study accordions, demo
  frames, footer) with inline styles preserved from the design, plus empty **stable
  containers** (`id`s) for every data-driven region.
- **[app.js](app.js)** — one IIFE holding all state, data, and behaviour:
  - **Data** (ported verbatim from the design): `FACILITIES`, `CHANNELS`, `MODEL_BRANCHES`,
    `MODEL_CONFIGS`, `MODEL_PAPER`, `CM`, `DATASET`, `RESULTS`; the 15 demo scenes — coords,
    RGB/IR thumbnail paths, and real per-channel-set model scores — come from `window.GALLERY`
    in **[gallery-data.js](gallery-data.js)** (loaded before `app.js`); `esri()` builds ArcGIS
    World Imagery export URLs.
  - **Render functions** fill the containers: `renderStatic` (galleries, dataset/score/macro
    bars), `renderModels` (chips + `buildModelDiagram` DOM-SVG + metrics), `renderConfusion`
    (matrix), `renderChannels`, `renderUpload` (idle/analyzing/done).
  - **Wiring**: `wireDelegation` (a single delegated click handler for `data-act` /
    `data-model` / `data-cm` / `data-ch` / `data-scene`), `wireScroll` (scan-line/rail),
    `initMap` (Leaflet + USGS tiles), `wireAccordion`, `wireFile`, `applyView`.

State lives in a plain `state` object; interactions mutate it and call the one affected
render function (no full re-render — the map and hero are never rebuilt).

## Model backend (production wiring)

Two analyze paths:

- **Map capture** (`captureMap`) is **live**: `runAnalysis({name,url})` fetches the framed export
  into a Blob and `POST`s it as `multipart/form-data` (field `image`) to `` `${API_BASE}/predict` ``;
  `computedResults()` renders `data.results` (`[{abbr,conf}]`, sorted), falling back to demo
  `RESULTS` until the first response. The button always fires (no readiness gating for now).
- **Channel scenes** (`analyzeSelection`) are a **demo**: `runDemoAnalysis` reveals the selected
  scene's real per-class scores from `window.GALLERY[scene].scores[set]` (set = `all`/`all4`/`rgb`,
  chosen by the active channels; arrays in order `[R&T, PROC, WWTP, LNDFL, CAFO, MINE]`) after the
  same animation — **no backend call** — so the demo is smooth and works even if the model is down.
  Not gated on readiness. Channel selection is **hierarchical**: NAIP RGB is always required, NAIP
  NIR is a prerequisite for Sentinel (`toggleChannel`).
- **File upload is not wired** (removed).

**Health check temporarily removed:** `/health` polling, the `#backendStatus` status pill, and the
Capture-button readiness gating were stripped out so `/predict` can be exercised directly — the
Capture button is always enabled. Re-add a `checkHealth()`/`renderStatus()` pair (and the
`#backendStatus` pill in [index.html](index.html)) when the health endpoint lands.

- **Same-origin deploy:** `API_BASE` (from [config.js](config.js)) is `/api`. In production a
  small Caddy container ([Caddyfile](Caddyfile) / [Dockerfile](Dockerfile)) serves the static app
  **and** reverse-proxies `/api/*` to the backend Cloud Run service. So there is **no CORS**. The
  backend is **unauthenticated**. Local dev can point `API_BASE` at a backend directly.
- **Backend contract** the team must implement: [BACKEND_API.md](BACKEND_API.md).

## Conventions

- Keep the design's inline styles in `index.html` for fidelity; don't extract to CSS
  unless refactoring the whole theme.
- Data-driven regions are rendered from `app.js` — edit the data arrays, not the HTML.
- Interactive elements carry `data-*` hooks; the delegated handler in `wireDelegation`
  routes them. New interactions follow that pattern.

## External dependencies (runtime, via network)

JetBrains Mono (Google Fonts), Leaflet 1.9.4 (unpkg), ESRI World Imagery + USGS NAIP tiles.
The app renders and runs offline; only map tiles / scene thumbnails need connectivity.

## Status

- **Design H ported** — fine-tuned model roster (7 configs, champion `ft-all` 0.852 macro AUPRC),
  compact AUPRC overlay on the diagram (per-class card removed), 15-scene gallery demo with real
  per-channel-set scores, hierarchical channel selection. All sections render; model selector,
  confusion matrix, channel routing, analyze flow, and threshold all work. H refinements over G:
  6-up square abbr-only data-facility gallery; model diagram in gold fusion styling with per-class
  sigmoid outputs labelled + a "MULTI-LABEL CLASSIFICATION" caption and a thicker bordered
  macro-AUPRC bar; restructured Demo intro (headline + `120 GB` / `19` channels / `6` classes stat
  list, SLB sustainability link); an optimizer/LR/batch line replacing the sensor colour legend;
  the map fills its grid row (basemap badge moved inside, refit-on-resize); hero coord readout
  (`rdCoord`) + rail dot removed (still null-guarded in `app.js`); footer model = `EfficientNetV2B0`;
  and refreshed section copy. `config.js` / `gallery-data.js` are unchanged from G.
- **Backend wiring in place** — real `/predict` (multipart), live results, error state,
  same-origin Caddy proxy. (`/health` polling + status pill temporarily removed — see above.)
  Backend contract handed off in
  [BACKEND_API.md](BACKEND_API.md); awaiting the deployed model service.
- **Gallery images delivered:** the 15 scenes now use real NAIP thumbnails in `gallery/`
  (`s01.png … s15.png`, 720×720), regenerated from the team's `naip.png` exports + the matching
  `prediction_image_demo_methane.json` (real per-channel-set scores). There is no separate IR set —
  each scene's `rgb` and `ir` both point at `sNN.png`, so toggling NAIP-NIR keeps the same image.
  The result panel now shows the selected NAIP scene (not a live ESRI export). The `wireSceneFallback`
  ESRI fallback remains as a safety net if a PNG is ever missing.
- **Open:** deploy both Cloud Run services (see [DEPLOY.md](DEPLOY.md)); optionally self-host
  fonts/Leaflet for a zero-network build. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
