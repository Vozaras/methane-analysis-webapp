"""Thin HTTP client for the methane detection backend."""
from __future__ import annotations

import requests

from . import config
from .schema import Prediction


class BackendError(RuntimeError):
    """Raised when the backend is unreachable or returns an error."""


def is_configured() -> bool:
    return bool(config.API_URL)


def health() -> bool:
    """Return True if the backend answers /health, False otherwise."""
    if not is_configured():
        return False
    try:
        r = requests.get(
            config.API_URL.rstrip("/") + config.HEALTH_PATH,
            timeout=min(config.API_TIMEOUT, 5),
        )
        return r.ok
    except requests.RequestException:
        return False


def predict(image_bytes: bytes, filename: str, threshold: float) -> Prediction:
    """POST an image to the backend and parse the prediction.

    Raises BackendError on any transport/parse failure so the UI can fall
    back to demo mode or surface a clear message.
    """
    if not is_configured():
        raise BackendError("No backend configured (METHANE_API_URL is empty).")

    url = config.API_URL.rstrip("/") + config.PREDICT_PATH
    try:
        resp = requests.post(
            url,
            files={"file": (filename, image_bytes)},
            data={"threshold": str(threshold)},
            timeout=config.API_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise BackendError(f"Could not reach backend at {url}: {exc}") from exc

    if not resp.ok:
        raise BackendError(f"Backend returned {resp.status_code}: {resp.text[:200]}")

    try:
        return Prediction.from_response(resp.json())
    except (ValueError, KeyError) as exc:
        raise BackendError(f"Malformed response from backend: {exc}") from exc
