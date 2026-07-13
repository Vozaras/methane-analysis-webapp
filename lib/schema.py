"""Data contract shared between this frontend and the FastAPI backend.

The backend must implement:

    POST /predict   (multipart/form-data)
        file:       the image to analyse (PNG/JPG/TIFF)
        threshold:  optional float in [0, 1], detection cut-off

    -> 200 application/json
    {
        "plume_detected": true,
        "confidence": 0.87,                 # overall, 0..1
        "mask_png_base64": "<base64 PNG>",  # optional grayscale mask, same HxW
        "plumes": [
            {
                "bbox": [x, y, w, h],       # pixels, top-left origin
                "confidence": 0.90,
                "area_px": 1234,
                "estimated_emission_rate_kg_h": 512.3   # optional
            }
        ],
        "meta": {"model": "unet-v1", "inference_ms": 123}
    }

    GET /health -> 200 {"status": "ok"}

`Prediction.from_response` parses that JSON into the objects the UI renders,
so both the mock detector and the real backend produce identical structures.
"""
from __future__ import annotations

import base64
import io
from dataclasses import dataclass, field

import numpy as np
from PIL import Image


@dataclass
class Plume:
    bbox: tuple[int, int, int, int]  # x, y, w, h in pixels
    confidence: float
    area_px: int
    estimated_emission_rate_kg_h: float | None = None


@dataclass
class Prediction:
    plume_detected: bool
    confidence: float
    plumes: list[Plume] = field(default_factory=list)
    mask: np.ndarray | None = None  # HxW float array in [0, 1], or None
    meta: dict = field(default_factory=dict)

    @classmethod
    def from_response(cls, data: dict) -> "Prediction":
        mask = None
        b64 = data.get("mask_png_base64")
        if b64:
            mask = decode_mask(b64)

        plumes = []
        for p in data.get("plumes", []) or []:
            bbox = tuple(int(v) for v in p["bbox"])  # type: ignore[assignment]
            plumes.append(
                Plume(
                    bbox=bbox,  # type: ignore[arg-type]
                    confidence=float(p.get("confidence", 0.0)),
                    area_px=int(p.get("area_px", 0)),
                    estimated_emission_rate_kg_h=(
                        float(p["estimated_emission_rate_kg_h"])
                        if p.get("estimated_emission_rate_kg_h") is not None
                        else None
                    ),
                )
            )

        return cls(
            plume_detected=bool(data.get("plume_detected", False)),
            confidence=float(data.get("confidence", 0.0)),
            plumes=plumes,
            mask=mask,
            meta=dict(data.get("meta", {}) or {}),
        )


def decode_mask(b64: str) -> np.ndarray:
    """Decode a base64 PNG into a float mask in [0, 1]."""
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("L")
    return np.asarray(img, dtype=np.float32) / 255.0


def encode_mask(mask: np.ndarray) -> str:
    """Encode a float mask in [0, 1] to a base64 PNG (used by the mock)."""
    arr = np.clip(mask * 255.0, 0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")
