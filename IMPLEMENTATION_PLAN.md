# Methane Webapp — Implementation & Handover Guide

> **Deliverable:** this document is to be saved in the project repo as
> `IMPLEMENTATION_PLAN.md` and used as the working guide when continuing the
> project in **VSCode with the Claude Code plugin**.

## ⚠️ How to use this guide (educational — read first)

**Execute one step at a time.** After each step, **stop, re-confirm the result**
(run the verification for that step), and only then decide the next action. Do not
batch multiple phases together. Each phase below ends with a **CHECKPOINT** — treat
it as a hard stop for review before moving on. The goal is understanding and a clean
handover, not speed.

---

## Context

The methane-analysis webapp (Le Wagon DS final project) is a **Streamlit** frontend
that sends satellite imagery to a **FastAPI `/predict`** backend (not built yet) and
visualises detected methane plumes/anomalies. A working Streamlit scaffold already
exists in `~/Main Coding Folder/methane-analysis-webapp` with **placeholder styling
(to be fully replaced)**: upload tab, demo/mock detector, plume overlay, results view.
The visual design is being **created from scratch in Claude Design** (Phase 2).

**Data source = Copernicus Sentinel-1/2 (ESRI dropped).** Sentinel data is **free, full,
and open** — the licence explicitly permits modification, ML, and commercial use (attribution
only: *"Contains modified Copernicus Sentinel data 2026"*). This removes the imagery-licensing
risk entirely. Sentinel-2 SWIR bands **B11/B12 (~20 m)** carry real methane-plume signal
(multiband–multipass retrieval), which an RGB basemap screenshot never could.

**Locked decisions (from the team):**
- **AOI selection** via **`streamlit-folium`** (Leaflet, open basemap, draw box / click point →
  geometry returns to Python). No custom JS component, no screenshotting.
- **Live-fetch** the actual S2/S1 imagery for the chosen AOI + date from the **Copernicus Data
  Space Ecosystem (CDSE) Sentinel Hub API**, plus keep an **upload** fallback for own tiles.
- **Band set is configurable** (default: true-color for display + **B11/B12** methane index);
  the model isn't built yet, so the evalscript is a config option the team locks later.
- Design is created from scratch in Claude Design — a new style scheme **and an AOI-map screen**
  (Phase 2). No prior design/theme retained.

## Copernicus / CDSE access — answer

- **Free.** Register a **CDSE account** at dataspace.copernicus.eu → in the **Sentinel Hub
  dashboard**, generate an **OAuth client (id + secret)** for API access.
- The **Sentinel Hub** and **openEO** APIs have **free monthly Processing-Unit (PU) quotas**;
  typical demo/AOI usage fits the free tier. Cache fetched tiles to conserve PUs.
- **Attribution required:** show *"Contains modified Copernicus Sentinel data 2026"* in the UI.
- API note: Sentinel Hub path structure was updated 2026-03-09 — follow current CDSE docs.

## Architecture & data flow (live-fetch)

1. User pans/zooms the **folium** map, **draws an AOI** (or clicks a point → fixed window),
   picks a **date/range** and **max cloud cover**.
2. `st_folium(...)` returns the AOI geometry (→ bbox) + zoom to Python.
3. `lib/copernicus.py`: OAuth2 client-credentials → token → **Sentinel Hub Process API** POST
   `{bbox, timeRange, evalscript, size, maxCC}` → image bytes (true-color PNG for display;
   and/or the band stack the model needs).
4. Display the fetched image; run it through the existing pipeline (`/predict`, or the mock)
   → existing overlay + metrics + results.
5. **Upload** tab remains for bring-your-own S1/S2 tiles.

The `/predict` contract and pipeline (`lib/mock.py`, `lib/schema.py`, `lib/api_client.py`, and
the `lib/overlay.py` structure) stay **unchanged** — a fetched tile is just another image source.
Only the overlay/theme **palette** follows the new design (Phase 3).

## Target repo layout
```
methane-analysis-webapp/
  IMPLEMENTATION_PLAN.md      # this file
  README.md                   # setup + CDSE creds + Copernicus attribution
  DESIGN.md                   # NEW — generated in Claude Design (Phase 2)
  app.py                      # Streamlit entry (Map / Upload / Sample tabs)
  requirements.txt            # + streamlit-folium, folium
  .env.example                # + CDSE_CLIENT_ID / CDSE_CLIENT_SECRET
  .streamlit/config.toml      # theme from DESIGN.md
  lib/
    config.py                 # + CDSE creds, SH base URL, default evalscript/bands
    copernicus.py             # NEW — CDSE OAuth + Sentinel Hub Process API client
    evalscripts.py            # NEW — default evalscripts (true-color; B11/B12 methane)
    schema.py api_client.py mock.py overlay.py samples.py   # pipeline (unchanged)
```

## New dependencies
- `streamlit-folium`, `folium` (map + Draw). Both pure-Python — verify wheels on Python 3.14.
- `requests` (already present) for OAuth + Process API. Optionally the `sentinelhub` SDK instead
  of a hand-rolled client — hand-rolled `requests` is lighter and more transparent (recommended).
- Only add raster deps (`rasterio`/`tifffile`) **if** the model needs raw float multi-band GeoTIFF;
  default keeps outputs as PNG to stay Python-3.14-friendly.

---

## Implementation phases

### Phase 0 — Handover setup
- **Action:** save this file as `IMPLEMENTATION_PLAN.md` in the repo; `git init`; commit the
  existing scaffold as the baseline.
- **Verify:** `git log` shows the baseline commit; repo opens cleanly in VSCode.
- **CHECKPOINT:** confirm the scaffold runs (`streamlit run app.py`) before changing anything.

### Phase 1 — Fix the first-run render stall
- **Why:** the current scaffold was observed stuck on "Running…" with an empty body in the
  preview browser. Resolve before adding features.
- **Action:** run locally, reproduce, diagnose (`streamlit run` console; bisect `app.py` —
  sidebar `health()`, sample-tile generation, CSS `@import`). Fix root cause.
- **Verify:** app renders title, sidebar, tabs within ~2 s on first load.
- **CHECKPOINT:** confirm a clean render before proceeding.

### Phase 2 — Design in Claude Design (style + AOI-map screen)  ← user-driven
- **Action (you, in the browser):** in **claude.ai/design**, create a **new** design-system
  project with (a) the style scheme and (b) a **screen for the AOI-map workflow** — map area,
  date/cloud controls, a "Fetch & analyse" action, and the results/metrics panel. Export the
  tokens into a fresh `DESIGN.md`.
- **Note:** Claude Design produces the **static visual frame** (layout, colors, type, control
  styling, a map *placeholder*). The live map is `streamlit-folium` (Phase 6), styled to match.
- **Verify:** `DESIGN.md` written with the new palette/type/spacing and a map-screen spec.
- **CHECKPOINT:** review the design with the team before implementing it.

### Phase 3 — Apply the new design to Streamlit
- **Action:** replace the scaffold's placeholder styling with the new `DESIGN.md` tokens —
  `.streamlit/config.toml` (theme colors), the injected CSS in `app.py`, and the plume-overlay
  palette in `lib/overlay.py` / `lib/config.py`.
- **Verify:** app matches the design; screenshot-compare against the Claude Design frame.
- **CHECKPOINT:** confirm visual parity before adding the map/fetch.

### Phase 4 — CDSE account + OAuth credentials  ← user-driven
- **Action (you):** register a free **CDSE account**; in the **Sentinel Hub dashboard** create an
  **OAuth client**. Put `CDSE_CLIENT_ID` / `CDSE_CLIENT_SECRET` in a local `.env` (never commit).
  Add them to `lib/config.py` (`os.environ.get(...)`) and to `.env.example` (commented).
- **Verify:** a token request succeeds (`python -c "from lib import copernicus; print(bool(copernicus.get_token()))"` once Phase 5 exists).
- **CHECKPOINT:** credentials present; token obtainable.

### Phase 5 — Build the Copernicus fetch client
- **Action:** write `lib/copernicus.py` — OAuth2 client-credentials token, then a
  `fetch_image(bbox, start, end, *, evalscript, size, max_cc)` calling the **Sentinel Hub Process
  API** and returning image bytes → `PIL.Image`. Put default evalscripts in `lib/evalscripts.py`
  (true-color; B11/B12 methane index). Add light disk caching (keyed by bbox+date+evalscript) to
  save PUs.
- **Verify (standalone):** fetch a known plume AOI+date (e.g. a documented S2 methane case) →
  returns a sensible image; second call hits cache.
- **CHECKPOINT:** live fetch works before wiring the UI.

### Phase 6 — Add the AOI map + fetch to `app.py`
- **Action:** add a **Map** tab (primary): `folium.Map` + `Draw` plugin, wrapped in `st_folium`;
  read back the drawn AOI → bbox; add date-range + max-cloud inputs; **Fetch & analyse** →
  `copernicus.fetch_image(...)` → existing `set_image()` → existing detect/results flow. Keep the
  **Upload** tab (own S1/S2 tiles) and optional **Sample tiles** (offline). If CDSE creds are
  missing, show a clear message and keep Upload/Sample working. Add the Copernicus attribution line.
- **Verify:** draw an AOI + pick a date → fetch → plume overlay + metrics render (via mock);
  Upload tab still works for a PNG/TIFF.
- **CHECKPOINT:** both input paths flow into the same results pipeline.

### Phase 7 — Backend wiring (when FastAPI `/predict` exists)
- **Action:** set `METHANE_API_URL`; the existing `lib/api_client.py` posts fetched/uploaded
  images to `/predict` and falls back to the mock on error. No UI changes needed.
- **Verify:** backend up → real predictions replace mock; backend down → graceful demo mode.
- **CHECKPOINT:** end-to-end real prediction confirmed.

---

## Verification quick-reference
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # incl. streamlit-folium, folium
export CDSE_CLIENT_ID=...  CDSE_CLIENT_SECRET=...   # free CDSE Sentinel Hub OAuth client
streamlit run app.py                       # Map (AOI+fetch) / Upload tabs
```

## Reference — `/predict` contract (already in `lib/schema.py`)
`POST /predict` (multipart: `file`, `threshold`) → JSON `{plume_detected, confidence,
mask_png_base64?, plumes:[{bbox,confidence,area_px,estimated_emission_rate_kg_h?}], meta}`.
`GET /health` → `{status:"ok"}`.

## Risks / open items
- **Resolution:** S2 10 m (visible) / 20 m (SWIR), S1 ~10 m — detects plumes/anomalies, **not**
  individual facilities at fine detail. Frame the UX around area analysis, not asset inspection.
- **PU quota:** cache fetched tiles; avoid re-fetching identical AOI+date+evalscript.
- **Scene availability:** an AOI+date may have no clear scene — pick the least-cloudy in a range,
  and message the user when none qualifies.
- **Band/model input undecided:** evalscript is configurable; default = true-color (display) +
  B11/B12 methane index. Lock with the model team before training-aligned inference.
- **Python 3.14 wheels:** verify `streamlit-folium`/`folium` install; add `rasterio`/`tifffile`
  only if raw float multi-band GeoTIFF is required by the model.
- **Attribution:** keep *"Contains modified Copernicus Sentinel data 2026"* visible in the UI.
