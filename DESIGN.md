# DESIGN.md — visual system

The app's design system, as built in Claude Design (source *Methane Detection - F*) and
carried into the port. Styles live inline in [index.html](index.html) and in the render
functions of [app.js](app.js); this file is the reference.

## Character

A dark "orbital instrument" console: near-black ground, a single electric-lime accent, a
monospace voice for every label and readout, flat surfaces, and hairline dividers. The
recurring motif is the **scan line** — a lime sweep that reveals detections as you scroll.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| Loam (ground) | `#13140e` | page background |
| Panel | `#1d1e16` | cards, insets, tracks |
| Panel-lift | `#23241b` | active chip / backbone fill |
| Iron | `#404040` | hairline borders, dividers, inactive |
| Ash | `#84837b` | muted labels, secondary text |
| Faint | `#6b6a62` | captions, index numerals |
| Bone | `#f4f3e8` | primary text |
| **Lime** | `#ebfc72` | **sole accent** — headlines' highlight, primary buttons, active state, scan line, plume/box detections |

Sensor colors (model diagram + legend): NAIP `#ebfc72` (lime), Sentinel-2 `#7cc7e8`,
Sentinel-1 `#e6b45e`. Error cells in the confusion matrix use `#e4785a`.

## Type

- **System sans** (`system-ui, -apple-system, 'Segoe UI', Roboto`) for display — headlines
  at weight 400 with tight negative tracking (`letter-spacing: -0.03em` and larger for big
  sizes). Headline scale runs ~72px (hero) / 58px (section) / 36px (accordion).
- **JetBrains Mono** (300/400/700) for every interface annotation: labels, eyebrows, metric
  readouts, buttons, tags, log lines, coordinates.

## Form

- **Radius** 3.6px almost everywhere (6px on channel cards); 0 on full-bleed imagery.
- **Flat** — no shadows except lime glow on the scan line and detection boxes.
- **Grids** with 1px/2px gaps over an iron ground read as hairline-ruled tables (stat grids,
  galleries, sensor cards).
- **Uppercase mono** micro-labels with `letter-spacing: 0` (the mono is already wide).

## Views

- **Landing** — sticky 100vh hero + 240vh scroll driver; a fixed right progress rail; the
  scan line and reveal layer are driven by scroll progress.
- **Study** — max-width 1200px column; numbered accordions (01–04) with `+`/`–` chevrons.
- **Demo** — intro, a square Leaflet map with a lime capture frame + crosshair, channel
  cards + scene picker, and the analyze/results screen with a threshold marker.

## Motion

`scanline` (analyzing sweep), `blink` (caret), `pulseGlow` (scan-line endpoints) — defined
in the `index.html` `<style>` block. Scroll drives the hero; everything else is state-driven.
