"""Built-in demo classifier.

Produces a plausible, deterministic category prediction without a backend, so
the UI is fully usable before the real model is deployed. The output matches the
`Prediction` contract exactly, so swapping in the real API changes nothing in
the UI layer.
"""
from __future__ import annotations

import numpy as np
from PIL import Image

from .schema import CATEGORIES, NEGATIVE, Prediction


def _rng_for(image: Image.Image) -> np.random.Generator:
    """Deterministic RNG seeded by image content, so results are stable."""
    small = np.asarray(image.convert("L").resize((32, 32)), dtype=np.uint64)
    seed = int(small.sum() % (2**32))
    return np.random.default_rng(seed)


def predict(image: Image.Image, threshold: float) -> Prediction:
    rng = _rng_for(image)

    # Deterministic per-category scores. Most tiles get a dominant source; the
    # rest stay low and fall through to "Negative".
    raw = rng.uniform(0.02, 0.35, size=len(CATEGORIES))
    if rng.uniform() < 0.75:  # ~75% of tiles have a clear methane source
        winner = int(rng.integers(len(CATEGORIES)))
        raw[winner] = rng.uniform(0.60, 0.98)
    scores = {cat: round(float(s), 3) for cat, s in zip(CATEGORIES, raw)}

    top = max(scores, key=scores.__getitem__)
    top_score = scores[top]

    if top_score < threshold:
        return Prediction(
            prediction=NEGATIVE,
            score=float(top_score),
            scores=scores,
            meta={"model": "demo-mock", "note": "no backend configured"},
        )
    return Prediction(
        prediction=top,
        score=float(top_score),
        scores=scores,
        meta={"model": "demo-mock"},
    )
