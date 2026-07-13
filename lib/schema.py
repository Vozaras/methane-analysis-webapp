"""Data contract shared between this frontend and the FastAPI backend.

The backend classifies a satellite image into one of six methane-source
categories (or "Negative") and returns a confidence score. This follows the
METER-ML benchmark (Zhu et al., 2022). See CLAUDE.md.

The backend must implement:

    POST /predict   (multipart/form-data)
        file:       the image to analyse (PNG/JPG/TIFF)
        threshold:  optional float in [0, 1]; below it, the top category is
                    reported as "Negative"

    -> 200 application/json
    {
        "prediction": "R&Ts",          # one CATEGORIES value, or "Negative"
        "score": 0.82,                 # confidence for `prediction`, 0..1
        "scores": {                    # optional per-category probabilities
            "CAFOs": 0.03, "Coal Mines": 0.01, "Landfills": 0.05,
            "Proc Plants": 0.06, "R&Ts": 0.82, "WWTPs": 0.03
        },
        "meta": {"model": "densenet121", "inference_ms": 120}
    }

    GET /health -> 200 {"status": "ok"}

`Prediction.from_response` parses that JSON into the object the UI renders, so
both the mock detector and the real backend produce identical structures.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# The six methane-source categories from METER-ML, in display order.
CATEGORIES: tuple[str, ...] = (
    "CAFOs",
    "Coal Mines",
    "Landfills",
    "Proc Plants",
    "R&Ts",
    "WWTPs",
)
NEGATIVE = "Negative"

# Human-readable labels for the UI.
CATEGORY_LABELS: dict[str, str] = {
    "CAFOs": "Concentrated animal feeding",
    "Coal Mines": "Coal mine",
    "Landfills": "Landfill",
    "Proc Plants": "Gas processing plant",
    "R&Ts": "Refinery / terminal",
    "WWTPs": "Wastewater treatment",
}


@dataclass
class Prediction:
    prediction: str  # a CATEGORIES value, or NEGATIVE
    score: float  # confidence for `prediction`, 0..1
    scores: dict[str, float] = field(default_factory=dict)  # per-category probs
    meta: dict = field(default_factory=dict)

    @property
    def is_negative(self) -> bool:
        return self.prediction == NEGATIVE

    @classmethod
    def from_response(cls, data: dict) -> "Prediction":
        scores = {
            k: float(v)
            for k, v in (data.get("scores") or {}).items()
            if k in CATEGORIES
        }
        prediction = str(data.get("prediction", NEGATIVE))
        score = data.get("score")
        if score is None:  # fall back to the predicted category's own score
            score = scores.get(prediction, 0.0)
        return cls(
            prediction=prediction,
            score=float(score),
            scores=scores,
            meta=dict(data.get("meta", {}) or {}),
        )
