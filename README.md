# Methane Source Classifier

A Streamlit web app that classifies satellite imagery by the type of **methane-emitting
facility** it contains. Provide a tile, and the backend model predicts one of six source
categories — or **Negative** — together with a confidence score.

The categories, and the modelling approach, follow Stanford's **METER-ML** benchmark
(Zhu et al., 2022, *A Multi-Sensor Earth Observation Benchmark for Automated Methane
Source Mapping*):

| Category | Meaning |
| --- | --- |
| CAFOs | Concentrated animal feeding operations |
| Coal Mines | Coal mines |
| Landfills | Landfills |
| Proc Plants | Natural gas processing plants |
| R&Ts | Oil refineries & petroleum terminals |
| WWTPs | Wastewater treatment plants |
| Negative | None of the above |

This is **image classification, not plume detection** — no gas-plume localisation or
emission estimates (visualisation may be added later). The model is trained and served by
a separate FastAPI backend; this repo is the frontend, and runs a built-in **demo
detector** when no backend is configured so the interface is usable on its own.

> Le Wagon — Data Science final project. See [CLAUDE.md](CLAUDE.md) for architecture and
> the current state of the code, and [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for
> the roadmap.

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Requires Python 3.14.

## Demo vs. backend mode

By default the app runs in **demo mode** — no backend or credentials needed. To use the
real model, point it at the backend (see [.env.example](.env.example)):

```bash
export METHANE_API_URL=http://localhost:8000   # FastAPI exposing POST /predict, GET /health
export METHANE_API_TIMEOUT=30                  # optional, seconds
streamlit run app.py
```

If `METHANE_API_URL` is empty the app stays in demo mode; if it's set but the backend is
down, the app falls back to the demo detector and shows a status pill in the sidebar.

## Backend contract

`POST /predict` (multipart `file`, optional `threshold`) returns the predicted category
and score; `GET /health` returns `{"status": "ok"}`. The exact JSON shape is documented in
[CLAUDE.md](CLAUDE.md) and defined in [lib/schema.py](lib/schema.py). The built-in demo
detector returns the same structure, so the UI is identical with or without a backend.

## Project layout

```
app.py                    # Streamlit UI + theme
lib/
  schema.py               # the /predict data contract (category + scores)
  mock.py                 # built-in demo classifier
  api_client.py           # backend HTTP client + demo fallback
  config.py               # env config + palette
  samples.py              # procedural demo tiles
.streamlit/config.toml    # theme
IMPLEMENTATION_PLAN.md     # roadmap
```

## Data & attribution

METER-ML is built from NAIP, Sentinel-1, and Sentinel-2 imagery. If Sentinel data is used
directly, display the Copernicus attribution: *"Contains modified Copernicus Sentinel data
2026"*.
