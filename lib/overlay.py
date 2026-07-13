"""Render prediction masks and boxes onto the source image.

Per the INVERSA design system, the plume layer is the "single neon-lime marker
over satellite earth photography" — so the mask is ramped through olive into
lime rather than a warm heatmap (lime is the system's only accent).
"""
from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw

from .config import PLUME_COLOR
from .schema import Prediction

# Olive -> lime intensity ramp. Stops are (position, R, G, B).
_STOPS = np.array(
    [
        [0.0, 19, 20, 14],      # obsidian (hidden by alpha)
        [0.35, 107, 122, 31],   # dark olive
        [0.7, 186, 205, 49],    # marsh olive
        [1.0, 235, 252, 114],   # lime surveyor
    ]
)


def _colormap(mask: np.ndarray) -> np.ndarray:
    """Map a HxW float mask in [0, 1] to an HxW3 uint8 RGB array."""
    pos = _STOPS[:, 0]
    r = np.interp(mask, pos, _STOPS[:, 1])
    g = np.interp(mask, pos, _STOPS[:, 2])
    b = np.interp(mask, pos, _STOPS[:, 3])
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def render(
    image: Image.Image,
    pred: Prediction,
    *,
    opacity: float = 0.55,
    draw_boxes: bool = True,
) -> Image.Image:
    """Return a copy of `image` with the plume marker and boxes drawn on top."""
    base = image.convert("RGBA")
    w, h = base.size

    if pred.mask is not None and pred.mask.any():
        mask = pred.mask
        if mask.shape != (h, w):
            mask = np.asarray(
                Image.fromarray((mask * 255).astype(np.uint8)).resize((w, h))
            ).astype(np.float32) / 255.0

        rgb = _colormap(mask)
        alpha = (np.clip(mask, 0, 1) * opacity * 255).astype(np.uint8)
        overlay = np.dstack([rgb, alpha])
        base = Image.alpha_composite(base, Image.fromarray(overlay, mode="RGBA"))

    if draw_boxes and pred.plumes:
        draw = ImageDraw.Draw(base)
        for p in pred.plumes:
            x, y, bw, bh = p.bbox
            draw.rectangle([x, y, x + bw, y + bh], outline=PLUME_COLOR + (255,), width=2)
            label = f"{p.confidence:.0%}"
            ty = max(0, y - 14)
            draw.rectangle([x, ty, x + 8 * len(label) + 6, ty + 14], fill=(19, 20, 14, 220))
            draw.text((x + 3, ty + 2), label, fill=PLUME_COLOR + (255,))

    return base.convert("RGB")
