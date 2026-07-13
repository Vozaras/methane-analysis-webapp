# CLAUDE.md — methane-analysis-webapp

Project context for Claude Code. Note: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
predates the task clarification below and is written around methane *plume detection*;
that framing is **superseded** — this app does *source classification*. Read this file
first.

## What this is

A **Streamlit** frontend for **methane-source classification** (Le Wagon Data Science
final project), based on Stanford's **METER-ML** work (Zhu et al., 2022 — "A Multi-Sensor
Earth Observation Benchmark for Automated Methane Source Mapping").

A user provides satellite imagery; a backend model classifies it into one of **six
methane-emitting facility categories**, or **Negative** if none scores high enough, and
returns a **confidence score**. This is **image classification, not plume detection** —
there is no gas-plume localisation, emission-rate estimate, or pixel mask (visualisation
may be added later, but is out of scope now).

### The six source categories (from METER-ML)

- **CAFOs** — concentrated animal feeding operations
- **Coal Mines**
- **Landfills**
- **Proc Plants** — natural gas processing plants
- **R&Ts** — oil refineries & petroleum terminals
- **WWTPs** — wastewater treatment plants
- (+ **Negative** — none of the above)

Imagery in METER-ML is multi-sensor (NAIP aerial, Sentinel-1, Sentinel-2). The reference
model is a DenseNet-121 multi-label classifier. The backend trains/serves the model; this
repo is the frontend only.

## `/predict` contract (classification)

Defined in [lib/schema.py](lib/schema.py) and produced identically by the mock and the
real backend. `POST /predict` (multipart: `file`, optional `threshold`) → JSON:

```json
{
  "prediction": "R&Ts",                 // one of the six categories, or "Negative"
  "score": 0.82,                        // confidence for the predicted category, 0..1
  "scores": {                           // optional per-category probabilities
    "CAFOs": 0.03, "Coal Mines": 0.01, "Landfills": 0.05,
    "Proc Plants": 0.06, "R&Ts": 0.82, "WWTPs": 0.03
  },
  "meta": {"model": "densenet121", "inference_ms": 120}
}
```

`GET /health` → `{"status": "ok"}`. "Negative" = the top category's score is below the
threshold. The category names are the exact `CATEGORIES` strings in `schema.py`; unknown
keys in `scores` are ignored on parse.

## Run

```bash
source .venv/bin/activate          # Python 3.14.4
pip install -r requirements.txt
streamlit run app.py
```

Demo mode is the default: when `METHANE_API_URL` is empty (see [.env.example](.env.example))
the built-in mock stands in for the backend. If it's set but the backend is down, the app
falls back to the mock and shows a status pill in the sidebar.

## Architecture

`app.py` — Streamlit entry: theme CSS, sidebar (threshold + backend status), input tabs
(Upload / Sample tiles), the **Classify source** action, and the results view (predicted
category, score, per-category score bars).

`lib/`:
- `schema.py` — the `/predict` data contract: `Prediction(prediction, score, scores,
  meta)`, plus `CATEGORIES`, `NEGATIVE`, `CATEGORY_LABELS`.
- `mock.py` — deterministic demo classifier (seeded by image content) that returns a
  category + per-category scores; falls through to `NEGATIVE` below the threshold.
- `api_client.py` — backend HTTP client (`health()`, `predict()`), raising `BackendError`
  so the UI degrades to demo mode. Transport layer, task-agnostic.
- `config.py` — env config (`API_URL`, timeouts, endpoint paths) + placeholder `ACCENT`.
- `samples.py` — procedurally generated demo tiles.

## Conventions

- Every module starts with `from __future__ import annotations`.
- The mock and the real backend must produce identical structures through `schema.py` —
  if the contract changes, change both together.
- Demo mode (empty `METHANE_API_URL`) must always keep working; the backend is optional.

## Status

- **Phase 0 (baseline): done** — git initialized, baseline commit.
- **Pipeline reconciled to classification: done** — `schema.py`/`mock.py`/`app.py` now
  implement the six-category + score contract; the old plume-detection `overlay.py` was
  removed (recoverable from the baseline commit if a visualisation layer is revived).
- **Deferred:** the render-stall fix (below), the styling redesign, and any live imagery
  fetch. `IMPLEMENTATION_PLAN.md` still describes these under a plume framing — read it as
  classification.

## Known issues

- **First-run render can stall:** [lib/samples.py](lib/samples.py) `make_tile()` is
  uncached and runs 4× per rerun; `api_client.health()` makes a network call per rerun and
  blocks if `METHANE_API_URL` is set with no backend listening.

## Design note

The current theme is a **placeholder** to be regenerated from scratch later — see
[DESIGN.md](DESIGN.md). Do not treat the current colours/CSS as final.
