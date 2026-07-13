"""Procedurally generated satellite-like tiles for demoing without real data."""
from __future__ import annotations

import numpy as np
from PIL import Image

_SIZE = 480


def _fractal_noise(size: int, rng: np.random.Generator, octaves: int = 5) -> np.ndarray:
    """Simple value-noise fractal in [0, 1] built from upscaled random layers."""
    out = np.zeros((size, size), dtype=np.float32)
    amp = 1.0
    total = 0.0
    for o in range(octaves):
        res = max(2, 2 ** (o + 1))
        base = rng.random((res, res)).astype(np.float32)
        layer = np.asarray(
            Image.fromarray((base * 255).astype(np.uint8)).resize(
                (size, size), Image.BICUBIC
            ),
            dtype=np.float32,
        ) / 255.0
        out += layer * amp
        total += amp
        amp *= 0.5
    out /= total
    return (out - out.min()) / (np.ptp(out) + 1e-6)


def _terrain_colormap(elev: np.ndarray) -> np.ndarray:
    """Map elevation in [0, 1] to an earthy RGB image (water/veg/rock)."""
    stops = np.array(
        [
            [0.0, 30, 55, 80],     # deep
            [0.35, 46, 82, 92],    # shallow
            [0.45, 90, 110, 70],   # lowland veg
            [0.65, 120, 130, 82],  # scrub
            [0.85, 150, 138, 110], # rock
            [1.0, 205, 200, 190],  # bright / bare
        ]
    )
    pos = stops[:, 0]
    r = np.interp(elev, pos, stops[:, 1])
    g = np.interp(elev, pos, stops[:, 2])
    b = np.interp(elev, pos, stops[:, 3])
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def make_tile(seed: int, size: int = _SIZE) -> Image.Image:
    rng = np.random.default_rng(seed)
    elev = _fractal_noise(size, rng)
    rgb = _terrain_colormap(elev).astype(np.float32)

    # Sprinkle a few bright "facility" pixels (methane sources tend to sit near
    # infrastructure), to give the tile a believable focal point.
    for _ in range(rng.integers(2, 5)):
        cy, cx = rng.integers(size // 6, size * 5 // 6, size=2)
        s = int(rng.integers(3, 7))
        rgb[cy - s : cy + s, cx - s : cx + s] = np.array([220, 210, 200])

    # Mild sensor noise for realism.
    rgb += rng.normal(0, 4, rgb.shape)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


# Named sample set surfaced in the UI.
SAMPLES: dict[str, int] = {
    "Permian Basin": 7,
    "Delta wetland": 21,
    "Desert facility": 42,
    "Coastal site": 99,
}
