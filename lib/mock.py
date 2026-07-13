"""Built-in demo detector.

Produces a plausible, deterministic plume prediction without a backend, so the
UI is fully usable before the real model is deployed. The output matches the
`Prediction` contract exactly, so swapping in the real API changes nothing in
the UI layer.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from .schema import Plume, Prediction


def _rng_for(image: Image.Image) -> np.random.Generator:
    """Deterministic RNG seeded by image content, so results are stable."""
    small = np.asarray(image.convert("L").resize((32, 32)), dtype=np.uint64)
    seed = int(small.sum() % (2**32))
    return np.random.default_rng(seed)


def _wind_plume(h: int, w: int, rng: np.random.Generator) -> tuple[np.ndarray, tuple[int, int]]:
    """A gaussian blob smeared along a wind direction -> HxW mask in [0, 1]."""
    yy, xx = np.mgrid[0:h, 0:w]
    # Source point somewhere in the middle of the frame.
    sy = int(rng.uniform(0.3, 0.7) * h)
    sx = int(rng.uniform(0.3, 0.7) * w)
    angle = rng.uniform(0, 2 * np.pi)
    dx, dy = np.cos(angle), np.sin(angle)

    # Coordinates relative to source, rotated into (along-wind, cross-wind).
    rx = xx - sx
    ry = yy - sy
    along = rx * dx + ry * dy
    cross = -rx * dy + ry * dx

    length = 0.28 * max(h, w)
    width = 0.06 * max(h, w)
    # Plume only extends downwind (along >= 0), widening with distance.
    downwind = np.clip(along, 0, None)
    spread = width * (1 + downwind / (length + 1e-6))
    mask = np.exp(-(cross**2) / (2 * spread**2)) * np.exp(-downwind / length)
    mask[along < -width] = 0
    return mask.astype(np.float32), (sx, sy)


def predict(image: Image.Image, threshold: float) -> Prediction:
    rng = _rng_for(image)
    w, h = image.size

    # Roughly 75% of images "contain" a plume in the demo.
    has_plume = rng.uniform() < 0.75
    if not has_plume:
        return Prediction(
            plume_detected=False,
            confidence=float(rng.uniform(0.05, 0.25)),
            plumes=[],
            mask=np.zeros((h, w), dtype=np.float32),
            meta={"model": "demo-mock", "note": "no backend configured"},
        )

    mask, (sx, sy) = _wind_plume(h, w, rng)
    binary = mask >= max(threshold, 0.15)

    ys, xs = np.where(binary)
    if len(xs) == 0:  # threshold too high; report a clean frame
        return Prediction(
            plume_detected=False,
            confidence=float(mask.max()),
            plumes=[],
            mask=mask,
            meta={"model": "demo-mock"},
        )

    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    area_px = int(binary.sum())
    confidence = float(min(0.99, 0.6 + mask.max() * 0.4))
    # Toy emission estimate: scale plume area to a kg/h figure.
    emission = round(area_px * rng.uniform(0.3, 0.6), 1)

    plume = Plume(
        bbox=(x0, y0, x1 - x0, y1 - y0),
        confidence=confidence,
        area_px=area_px,
        estimated_emission_rate_kg_h=emission,
    )
    return Prediction(
        plume_detected=True,
        confidence=confidence,
        plumes=[plume],
        mask=mask,
        meta={"model": "demo-mock", "source_px": [sx, sy]},
    )
