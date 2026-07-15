# Methane Source Mapping — web app

A single-page web app for **methane-source facility mapping**, based on Stanford's
**METER-ML** benchmark. It presents the study (dataset, model experiments, scores) and a
demo that takes a satellite scene — captured from a map or picked from preloaded channels —
and returns per-class confidence across six facility types.

The six classes: **R&T** (refineries & terminals), **CAFO** (feeding operations), **PROC**
(gas processing plants), **MINE** (coal mines), **LNDFL** (landfills), **WWTP** (wastewater
plants).

> The UI was designed in Claude Design (source: *Methane Detection - F*) and hand-ported to
> a clean static site (plain HTML/CSS/JS — no framework, no build step).

## Run

It's a static site — serve the folder and open it:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Or deploy `index.html` + `app.js` to any static host (Netlify, Vercel, Cloudflare Pages,
GitHub Pages, S3). No build.

**Network note:** the app is self-contained except for three live resources it streams at
runtime — JetBrains Mono (Google Fonts), Leaflet (unpkg), and satellite imagery (ESRI World
Imagery + USGS NAIP). It renders and runs without them; only the map tiles and scene
thumbnails need connectivity.

## Structure

| File | Purpose |
| --- | --- |
| `index.html` | Static chrome — nav, scan-line hero, study sections, demo frames, footer — with stable containers for the data-driven regions. |
| `app.js` | All data + logic: renders every dynamic region, builds the model-architecture SVG, and wires the map, scroll animation, accordions, and demo flow. |

## Views

- **Landing** — a scroll-driven scan-line hero over a live satellite scene.
- **Study** — METER-ML replication: Results, Data, Models (interactive architecture diagram +
  metrics), Scores (per-class bars, macro-by-config, interactive confusion matrix).
- **Demo** — a Leaflet map with a 720×720 capture frame, a channel/scene picker, and an
  analyze → per-class-confidence results screen with a probability-threshold slider.

## Wiring the real model backend

Analysis is currently **mocked**. The single swap point is `runAnalysis()` in
[app.js](app.js): replace its body with a call to your inference endpoint —

```js
const body = new FormData(); body.append('image', file);
const res  = await fetch('https://YOUR_API/predict', { method: 'POST', body });
const data = await res.json();  // { results: [{ abbr, name, conf }], boxes: [{ x, y, w, h, label }] }
```

— then have `renderUpload()` read `data.results` instead of the hardcoded `RESULTS` array.
See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the full backend plan.

## Attribution

- Model & dataset: **METER-ML** (Zhu, Lui, Irvin et al., Stanford, 2022) — 86,599
  NAIP / Sentinel-1 / Sentinel-2 scenes, six facility classes (Zenodo 6911013).
- Imagery: **ESRI World Imagery** and **USGS NAIP** (public domain).
