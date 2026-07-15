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
map **Capture & analyze** button until the service responds `200 OK`. (The channel-scene demo does
not call the backend.) Use it as the Cloud Run readiness probe too.

- **`200 OK`** once the service can serve.
- Return **`503`** while still warming up so the UI shows "waking".

**Response body (200):**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "model": "EfficientNetV2B0"
}
```
The front-end treats **any `200 OK`** as ready — it no longer requires a `model_loaded: true`
confirmation. All body fields are informational; a `model_loaded` flag, if present, is ignored.

---

## `POST /predict`

Runs inference on one scene image and returns per-class confidence.

**Request**
- `Content-Type: multipart/form-data`
- One file field named **`image`** — a JPEG or PNG, square, up to ~**720×720**, ≤ ~**5 MB**.
- No other fields are required.

**Response (200) body** — a flat object mapping each class name to its confidence:
```json
{
  "RefineriesAndTerminals": 0.8909344673156738,
  "WWTreatment":            0.8522304892539978,
  "Landfills":              0.0003248385328333825,
  "ProcessingPlants":       0.00000176638025095599,
  "Mines":                  0.0000014670441714770277,
  "CAFOs":                  1.0181257746599837e-11
}
```

**Rules:**
- Return **all six** classes on every call.
- Each value is a float in **[0, 1]** (scientific notation like `1.0e-11` is fine).
- Order does not matter — the front-end sorts by confidence.
- The **class-name keys are fixed** and must match exactly. The front-end maps them to its
  internal `abbr` codes (see `PREDICT_KEY_TO_ABBR` in [app.js](app.js)):

  | key (JSON)               | abbr    | class                       |
  |--------------------------|---------|-----------------------------|
  | `RefineriesAndTerminals` | `R&T`   | Refineries & Terminals      |
  | `CAFOs`                  | `CAFO`  | Feeding Operations (CAFOs)  |
  | `ProcessingPlants`       | `PROC`  | Gas Processing Plants       |
  | `Mines`                  | `MINE`  | Coal Mines                  |
  | `Landfills`              | `LNDFL` | Landfills                   |
  | `WWTreatment`            | `WWTP`  | Wastewater Plants           |

> **Legacy shape (still accepted):** the front-end also parses the older
> `{ "results": [ { "abbr", "conf" }, … ], "model"? }` form, so an older backend build keeps
> working. New backends should use the flat object above.

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
