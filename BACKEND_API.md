# Backend API contract — methane-analysis-webapp

This is what the front-end needs the model backend to provide. The backend runs as a **Docker
container on Cloud Run**. The front-end is a separate Cloud Run service (Caddy) that serves the
static app **and reverse-proxies `/api/*` to this backend**, so:

- The backend is called **server-to-server by the proxy**, never directly by browsers.
- **CORS is not required** (see note below).
- The endpoints are **unauthenticated** — no API key or token to validate.

Two endpoints: `GET /health` and `POST /predict`.

---

## Transport & auth

- **Protocol:** HTTPS (Cloud Run provides this automatically).
- **Port:** the container must listen on `$PORT` (Cloud Run sets it; default `8080`).
- **Auth:** **none** — both endpoints are unauthenticated. Deploy with `--allow-unauthenticated`.
- **CORS:** **not needed** for this deployment — the browser only ever calls the front-end's own
  origin (the Caddy proxy forwards `/api/*` server-to-server). Only add CORS headers if you expect
  the backend to be called directly from a browser on a different origin.

---

## `GET /health`

Readiness probe. The front-end polls this on load and shows a status pill; it also gates the
map **Capture & analyze** button until the model is ready. (The channel-scene demo does not call
the backend.) Use it as the Cloud Run readiness probe too.

- **`200 OK`** only when the model weights are loaded and it can serve.
- Return **`503`** (with `model_loaded: false`) while still warming up so the UI shows "waking".

**Response body (200):**
```json
{
  "status": "ok",
  "model_loaded": true,
  "version": "1.0.0",
  "model": "EfficientNetV2B0"
}
```
The front-end only strictly requires **`model_loaded: true`**; the other fields are informational.

---

## `POST /predict`

Runs inference on one scene image and returns per-class confidence.

**Request**
- `Content-Type: multipart/form-data`
- One file field named **`image`** — a JPEG or PNG, square, up to ~**720×720**, ≤ ~**5 MB**.
- No other fields are required.

**Response (200) body:**
```json
{
  "results": [
    { "abbr": "R&T",   "conf": 0.94 },
    { "abbr": "CAFO",  "conf": 0.04 },
    { "abbr": "PROC",  "conf": 0.71 },
    { "abbr": "MINE",  "conf": 0.02 },
    { "abbr": "LNDFL", "conf": 0.11 },
    { "abbr": "WWTP",  "conf": 0.29 }
  ],
  "model": "EfficientNetV2B0",
  "elapsed_ms": 812
}
```

**Rules for `results`:**
- Return **all six** classes on every call.
- `conf` is a float in **[0, 1]**.
- Order does not matter — the front-end sorts by confidence.
- `abbr` values are **fixed** and must match exactly:

  | abbr    | class                       |
  |---------|-----------------------------|
  | `R&T`   | Refineries & Terminals      |
  | `CAFO`  | Feeding Operations (CAFOs)  |
  | `PROC`  | Gas Processing Plants       |
  | `MINE`  | Coal Mines                  |
  | `LNDFL` | Landfills                   |
  | `WWTP`  | Wastewater Plants           |

- **Optional** fields the front-end will use if present: a `name` per result; a top-level
  `model` string (shown in the results header); `boxes: [{ x, y, w, h, label }]` for future
  bounding-box overlays.

**Errors** — respond with a JSON body `{ "error": "message" }` and an appropriate status:

| Status | When                              |
|--------|-----------------------------------|
| `400`  | missing/invalid `image`           |
| `413`  | image too large                   |
| `500`  | inference failure                 |

The front-end shows the `error` message (or the HTTP status) on a "Try again" screen.

---

## Please confirm with us

- **Typical `/predict` latency** — sizes the front-end timeout (currently 60s) and the Cloud Run
  request timeout.
- **Cold-start behaviour** — will `min-instances` be set, or should the front-end expect the
  first request after idle to be slow? (The UI already retries `/health`.)
- **Max accepted body size** — so we can cap/resize on the client if needed.
