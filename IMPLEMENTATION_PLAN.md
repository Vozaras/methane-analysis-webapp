# Methane Webapp — Implementation & Handover Guide

> **Deliverable:** this document lives in the project repo as `IMPLEMENTATION_PLAN.md`
> and is the working guide when continuing the project in **VSCode with the Claude Code
> plugin**.

## ⚠️ How to use this guide (educational — read first)

**Execute one step at a time.** After each step, **stop, re-confirm the result** (run the
verification for that step), and only then decide the next action. Do not batch multiple
phases together. Each phase below ends with a **CHECKPOINT** — treat it as a hard stop for
review before moving on. The goal is understanding and a clean handover, not speed.

---

## Context

The methane-analysis webapp (Le Wagon DS final project) is a **Streamlit** frontend that
sends satellite imagery to a **FastAPI `/predict`** backend and reports which
**methane-emitting facility** the image contains.

**The task is image _classification_, not plume detection.** It follows Stanford's
**METER-ML** benchmark (Zhu et al., 2022): a model classifies a satellite tile into one of
**six methane-source categories** — **CAFOs** (concentrated animal feeding), **Coal
Mines**, **Landfills**, **Proc Plants** (natural-gas processing), **R&Ts** (refineries &
petroleum terminals), **WWTPs** (wastewater treatment) — or **Negative** if none scores
high enough, plus a **confidence score**. The reference model is a DenseNet-121 multi-label
classifier. There is **no gas-plume localisation, emission estimate, or pixel mask**
(a visualisation layer may be added later, but is out of scope).

> **History:** an earlier version of this plan was written around methane *plume detection*
> (Sentinel-2 B11/B12 SWIR retrieval, plume overlays). That framing is **superseded**. The
> frontend pipeline has since been reconciled to the classification contract (Phase 1,
> done). See [CLAUDE.md](CLAUDE.md).

**Data source = multi-sensor Earth observation.** METER-ML pairs each location with **NAIP**
(US aerial, 1 m), **Sentinel-1** (SAR, ~10 m), and **Sentinel-2** (10/20/60 m), over a
**720 m × 720 m** footprint. NAIP is US-only; **Sentinel-1 + Sentinel-2 are free, global,
and open** (Copernicus licence: modification/ML/commercial use allowed with attribution —
*"Contains modified Copernicus Sentinel data 2026"*). The paper's best model uses NAIP, but
the **globally transferable** S1+S2 model still identifies CAFOs strongly (AUPRC ≈ 0.92).

**Locked decisions (from the team):**
- **AOI selection** via **`streamlit-folium`** (Leaflet, open basemap, draw box / click
  point → geometry returns to Python). No custom JS, no screenshotting.
- **Live-fetch** the actual S2/S1 imagery for the chosen AOI + date from the **Copernicus
  Data Space Ecosystem (CDSE) Sentinel Hub API**, plus keep an **upload** fallback (own
  tiles) and offline **sample tiles**.
- **The fetched tile must match what the backend model was trained on** (bands,
  footprint/resolution, normalisation). The evalscript / band set is a **config option** the
  team locks with the model team — see Risks. Default: Sentinel-2 true-color for display,
  and whatever band stack the classifier expects for inference.
- Design is created from scratch later; the current theme is a **placeholder**
  ([DESIGN.md](DESIGN.md)). No prior design retained.

## Copernicus / CDSE access

- **Free.** Register a **CDSE account** at dataspace.copernicus.eu → in the **Sentinel Hub
  dashboard**, generate an **OAuth client (id + secret)** for API access.
- **Sentinel Hub** / **openEO** have free monthly Processing-Unit (PU) quotas; demo/AOI
  usage fits the free tier. **Cache** fetched tiles to conserve PUs.
- **Attribution required:** show *"Contains modified Copernicus Sentinel data 2026"* in the UI.

## Architecture & data flow (live-fetch → classify)

1. User pans/zooms the **folium** map, **draws an AOI** (or clicks a point → fixed window),
   picks a **date/range** and **max cloud cover**.
2. `st_folium(...)` returns the AOI geometry (→ bbox) to Python.
3. `lib/copernicus.py`: OAuth2 client-credentials → token → **Sentinel Hub Process API** POST
   `{bbox, timeRange, evalscript, size, maxCC}` → image bytes → `PIL.Image` (true-color for
   display; and/or the band stack the model needs).
4. Send the fetched image through the existing pipeline (`/predict`, or the mock) → a
   `Prediction` = **category + score + per-category scores**.
5. Display the fetched tile, the predicted category, its score, and the per-category score
   bars. **Upload** and **Sample tiles** tabs remain as alternative inputs.

The `/predict` contract and pipeline (`lib/schema.py`, `lib/mock.py`, `lib/api_client.py`)
stay **unchanged** — a fetched tile is just another image source. Only the imagery-sourcing
layer (`lib/copernicus.py`) and the Map tab are new.

## Target repo layout
```
methane-analysis-webapp/
  IMPLEMENTATION_PLAN.md      # this file
  CLAUDE.md                   # project context for Claude Code            (done)
  README.md                   # setup + CDSE creds + Copernicus attribution (done)
  DESIGN.md                   # placeholder theme; regenerate from scratch  (done, placeholder)
  app.py                      # Streamlit entry (Map / Upload / Sample tabs)
  requirements.txt            # + streamlit-folium, folium
  .env.example                # + CDSE_CLIENT_ID / CDSE_CLIENT_SECRET
  .streamlit/config.toml      # theme
  lib/
    config.py                 # + CDSE creds, SH base URL, default evalscript/bands
    copernicus.py             # NEW — CDSE OAuth + Sentinel Hub Process API client
    evalscripts.py            # NEW — evalscripts for the classifier's input bands
    schema.py mock.py api_client.py samples.py   # classification pipeline (done)
```

## New dependencies
- `streamlit-folium`, `folium` (map + Draw). Both pure-Python — **verify wheels on Python
  3.14**.
- `requests` (already present) for OAuth + Process API. A hand-rolled `requests` client is
  lighter and more transparent than the `sentinelhub` SDK (recommended).
- Add raster deps (`rasterio`/`tifffile`) **only if** the classifier needs raw float
  multi-band GeoTIFF input; default keeps outputs as PNG to stay Python-3.14-friendly.

---

## Implementation phases

### Phase 0 — Handover setup ✅ done
- Repo initialised (`git`), baseline scaffold committed.

### Phase 1 — Reconcile the pipeline to classification ✅ done
- **What was done:** rewrote the `/predict` contract and pipeline from plume detection to
  six-category classification — `lib/schema.py` (`Prediction(prediction, score, scores,
  meta)`, `CATEGORIES`, `NEGATIVE`, `CATEGORY_LABELS`), `lib/mock.py` (deterministic
  category + scores, Negative below threshold), `app.py` (Classify flow + per-category score
  bars); removed the plume `lib/overlay.py`.
- **Verified:** unit-exercised the pipeline and ran `app.py` through Streamlit's AppTest
  harness end-to-end (renders, classifies a sample, no errors).

### Phase 2 — Fix the first-run render stall
- **Why:** the scaffold can stall on first load with an empty body.
- **Action:** run locally, reproduce, diagnose. Prime suspects: `lib/samples.py`
  `make_tile()` is **uncached** and runs 4× per rerun (wrap with `@st.cache_data`);
  `api_client.health()` makes a **network call per rerun** that blocks if `METHANE_API_URL`
  is set with no backend listening (guard/cache it); the CSS Google-Fonts `@import`.
- **Verify:** app renders title, sidebar, tabs within ~2 s on first load.
- **CHECKPOINT:** confirm a clean render before adding features.

### Phase 3 — Design from scratch (style + AOI-map screen)  ← user-driven
- **Action (in the browser):** create a **new** design system with (a) the style scheme and
  (b) a **screen for the AOI-map workflow** — map area, date/cloud controls, a "Fetch &
  classify" action, and a results panel showing the predicted category + per-category
  scores. Export the tokens into a fresh `DESIGN.md` (replacing the placeholder).
- **Verify:** `DESIGN.md` rewritten with the new palette/type/spacing and a map-screen spec.
- **CHECKPOINT:** review the design with the team before implementing it.

### Phase 4 — Apply the new design to Streamlit
- **Action:** replace the placeholder styling with the new `DESIGN.md` tokens —
  `.streamlit/config.toml` (theme colors), the injected CSS in `app.py`, and `ACCENT` in
  `lib/config.py`.
- **Verify:** app matches the design; screenshot-compare against the design frame.
- **CHECKPOINT:** confirm visual parity before adding the map/fetch.

### Phase 5 — CDSE account + OAuth credentials  ← user-driven
- **Action:** register a free **CDSE account**; in the **Sentinel Hub dashboard** create an
  **OAuth client**. Put `CDSE_CLIENT_ID` / `CDSE_CLIENT_SECRET` in a local `.env` (never
  commit). Read them in `lib/config.py` (`os.environ.get(...)`) and add commented entries to
  `.env.example`.
- **Verify:** a token request succeeds (once Phase 6 exists:
  `python -c "from lib import copernicus; print(bool(copernicus.get_token()))"`).
- **CHECKPOINT:** credentials present; token obtainable.

### Phase 6 — Build the Copernicus fetch client
- **Action:** write `lib/copernicus.py` — OAuth2 client-credentials token, then
  `fetch_image(bbox, start, end, *, evalscript, size, max_cc)` calling the **Sentinel Hub
  Process API** and returning image bytes → `PIL.Image`. Put evalscripts in
  `lib/evalscripts.py` — **matched to the classifier's expected input** (default: S2
  true-color for display; plus the band stack the model was trained on). Add light disk
  caching keyed by bbox+date+evalscript to save PUs. Target a footprint/resolution
  comparable to METER-ML's 720 m tiles.
- **Verify (standalone):** fetch a known facility AOI+date (e.g. a large CAFO or refinery)
  → returns a sensible image; second call hits cache.
- **CHECKPOINT:** live fetch works before wiring the UI.

### Phase 7 — Add the AOI map + fetch to `app.py`
- **Action:** add a **Map** tab (primary): `folium.Map` + `Draw`, wrapped in `st_folium`;
  read back the drawn AOI → bbox; add date-range + max-cloud inputs; **Fetch & classify** →
  `copernicus.fetch_image(...)` → existing `set_image()` → existing classify/results flow
  (category + per-category scores). Keep the **Upload** and **Sample tiles** tabs. If CDSE
  creds are missing, show a clear message and keep Upload/Sample working. Add the Copernicus
  attribution line.
- **Verify:** draw an AOI + pick a date → fetch → predicted category + score bars render
  (via mock); Upload tab still works for a PNG/TIFF.
- **CHECKPOINT:** all input paths flow into the same classification results.

### Phase 8 — Backend wiring (when the FastAPI classifier exists)
- **Action:** set `METHANE_API_URL`; the existing `lib/api_client.py` posts fetched/uploaded
  images to `/predict` and falls back to the mock on error. No UI changes needed, provided
  the backend returns the `schema.py` contract.
- **Verify:** backend up → real predictions replace the mock; backend down → graceful demo
  mode.
- **CHECKPOINT:** end-to-end real classification confirmed.

---

## Verification quick-reference
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # incl. streamlit-folium, folium (Phase 6+)
export CDSE_CLIENT_ID=...  CDSE_CLIENT_SECRET=...   # free CDSE Sentinel Hub OAuth client
streamlit run app.py                       # Map (AOI+fetch) / Upload / Sample tabs
```

## Reference — `/predict` contract (in `lib/schema.py`)
`POST /predict` (multipart: `file`, optional `threshold`) → JSON
`{prediction, score, scores:{category:prob,…}, meta}`, where `prediction` is one of the six
`CATEGORIES` or `"Negative"`. `GET /health` → `{"status":"ok"}`. The mock produces the same
structure, so backend and demo mode are UI-identical.

## Risks / open items
- **Input matching (central):** the backend model is trained on specific products/bands/
  footprint (METER-ML: NAIP + S1 + S2, 720 m tiles). A live-fetched Sentinel tile must match
  the model's expected **bands, footprint/resolution, and normalisation**, or accuracy
  collapses. Lock the evalscript + preprocessing with the model team.
- **NAIP is US-only** and the paper's *best* model uses NAIP; the global S1+S2 model is
  weaker overall but still strong on CAFOs. Decide whether the served model is US-NAIP or
  global-S1/S2, and fetch accordingly.
- **Per-category difficulty:** the paper reports high AUPRC for CAFOs and R&Ts, much lower
  for Landfills/Proc Plants. Frame UX expectations around this; the **Negative** class is
  threshold-driven.
- **PU quota:** cache fetched tiles; avoid re-fetching identical AOI+date+evalscript.
- **Scene availability:** an AOI+date may have no clear scene — pick the least-cloudy in a
  range, and message the user when none qualifies.
- **Python 3.14 wheels:** verify `streamlit-folium`/`folium` install; add `rasterio`/
  `tifffile` only if raw float multi-band GeoTIFF input is required.
- **Attribution:** keep *"Contains modified Copernicus Sentinel data 2026"* visible in the UI.
