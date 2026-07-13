"""Runtime configuration, read from environment with sensible defaults."""
from __future__ import annotations

import os

# Base URL of the FastAPI backend. Empty string => demo/mock mode.
API_URL: str = os.environ.get("METHANE_API_URL", "").strip()

# HTTP timeout for prediction calls, in seconds.
API_TIMEOUT: float = float(os.environ.get("METHANE_API_TIMEOUT", "30"))

# Endpoint paths on the backend.
PREDICT_PATH = "/predict"
HEALTH_PATH = "/health"

# Placeholder palette (see DESIGN.md). Lime is the single accent.
ACCENT = "#ebfc72"           # lime
