# DESIGN.md — placeholder theme

> ⚠️ **PLACEHOLDER — do not treat as final.**
> This documents the *current* scaffold styling only so the code's "see DESIGN.md"
> references resolve. The design will be regenerated from scratch later and this
> file will be replaced. No part of the theme below is locked.

## Overview

A dark, flat "instrument console" placeholder: shadowless surfaces, near-zero border
radius, a monospace voice for every interface label, and a single electric-lime accent.

## Palette

Mirrors the values currently hard-coded in [app.py](app.py) (theme CSS),
[lib/config.py](lib/config.py) (`ACCENT`), and
[.streamlit/config.toml](.streamlit/config.toml):

| Token          | Hex        | Use                                  |
| -------------- | ---------- | ------------------------------------ |
| Background     | `#13140e`  | page canvas                          |
| (sidebar lift) | `#1b1c14`  | secondary background                 |
| Text           | `#f4f3e8`  | primary text                         |
| Border         | `#404040`  | hairline borders                     |
| Muted          | `#84837b`  | muted labels / captions              |
| Accent (lime)  | `#ebfc72`  | **sole accent** — primary button, status pill, score bars |
| Secondary      | `#bacd31`  | reserved secondary                   |

## Type

- **JetBrains Mono** (weights 300 / 400 / 700) for all interface annotations: labels,
  captions, metric readouts, buttons, tabs, tags.
- Headings are humanist sans, weight 400, tight tracking (`letter-spacing: -0.02..-0.03em`).

## Rules

- **Flat:** no shadows / elevation anywhere.
- **Sharp:** zero border radius on images and metric cards; ~3.6px only on buttons/tags.
- **Metrics as instruments:** transparent fill, 1px border, uppercase mono labels.
- **Accent discipline:** the lime is the *only* accent — primary button, backend status
  pill, and category score bars; everything else is greyscale/earth tones.

## When replacing this file

Regenerate the palette, type, spacing, and control styling, then update the tokens in
`.streamlit/config.toml`, the injected CSS in `app.py`, and `ACCENT` in `lib/config.py`
to match. If a plume/emission visualisation layer is ever added, add its overlay palette
here (an earlier olive→lime mask ramp lives in the baseline commit's `lib/overlay.py`).
