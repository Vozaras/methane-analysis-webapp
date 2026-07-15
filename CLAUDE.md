# CLAUDE.md — methane-analysis-webapp

Project context for Claude Code.

## What this is

A **static single-page web app** (plain HTML/CSS/JS — no framework, no build) for
methane-source facility mapping, based on Stanford's **METER-ML** benchmark. Two halves: a
**Study** (dataset, six model experiments, scores) and a **Demo** (map/scene → per-class
confidence across six facility classes: R&T, CAFO, PROC, MINE, LNDFL, WWTP).

The UI was designed in Claude Design (source *Methane Detection - F.dc.html*) and
**hand-ported** to this repo — the Claude Design authoring runtime (`<x-dc>`, `support.js`,
React) was removed and its `DCLogic` component reimplemented in vanilla JS.

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
  - **Data** (ported verbatim from the design): `FACILITIES`, `CHANNELS`/`CHANNEL_COORDS`,
    `MODEL_BRANCHES`, `MODEL_CONFIGS`, `MODEL_PAPER`, `CM`, `DATASET`, `RESULTS`; `esri()`
    builds ArcGIS World Imagery export URLs.
  - **Render functions** fill the containers: `renderStatic` (galleries, dataset/score/macro
    bars), `renderModels` (chips + `buildModelDiagram` DOM-SVG + metrics), `renderConfusion`
    (matrix), `renderChannels`, `renderUpload` (idle/analyzing/done).
  - **Wiring**: `wireDelegation` (a single delegated click handler for `data-act` /
    `data-model` / `data-cm` / `data-ch` / `data-scene`), `wireScroll` (scan-line/rail),
    `initMap` (Leaflet + USGS tiles), `wireAccordion`, `wireFile`, `applyView`.

State lives in a plain `state` object; interactions mutate it and call the one affected
render function (no full re-render — the map and hero are never rebuilt).

## Model backend seam

Analysis is **mocked** in `runAnalysis()` (streams log lines → `phase:'done'`, then
`renderUpload()` shows the fixed `RESULTS` confidences). To wire the real model, replace
`runAnalysis`'s body with a `POST /predict` fetch returning
`{ results:[{abbr,name,conf}], boxes:[...] }` and have `renderUpload` read `data.results`.

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

- **Design F ported and verified** — all sections render; model selector, confusion matrix,
  channel routing, analyze flow, and threshold all work (headless-tested).
- **Open:** wire the real `/predict` backend (replace the mock); optionally self-host
  fonts/Leaflet for a zero-network build. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
