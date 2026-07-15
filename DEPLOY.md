# Deploy — methane-analysis-webapp

Two Cloud Run services on GCP:

```
Browser ──HTTPS──▶ methane-frontend (this repo, Caddy)
                    ├─ serves index.html · app.js · config.js
                    └─ /api/*  ──reverse_proxy──▶ methane-backend (/health, /predict)
```

The **frontend** is same-origin with the API (the Caddy proxy forwards `/api/*` to the backend),
so there is **no CORS**. The backend endpoints are **unauthenticated**. This guide covers deploying
the frontend; the backend is owned by the model team — you only need its URL.

---

## 0. Prerequisites

- `gcloud` CLI installed and logged in: `gcloud auth login`
- Copy the env template and fill in your values (see [.env.example](.env.example)):
  ```bash
  cp .env.example .env
  # edit .env → PROJECT_ID, REGION, SERVICE_NAME, BACKEND_URL
  ```
  These drive the deploy commands (they are not read by the running app). `.env` is gitignored.
  Load them into your shell before running any gcloud command manually:
  ```bash
  set -a; source .env; set +a
  ```

Enable the APIs (one-time per project):
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

---

## 1. Deploy the frontend

Easiest — [deploy.sh](deploy.sh) loads `.env` and runs the deploy (from the repo root):
```bash
./deploy.sh
```

Or do it manually (after `set -a; source .env; set +a`):
```bash
gcloud config set project "$PROJECT_ID"

gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "BACKEND_URL=${BACKEND_URL}"
```
- `--allow-unauthenticated` makes the **website** public.
- `BACKEND_URL` → the Caddyfile's `{$BACKEND_URL}` (where `/api/*` is proxied).

Either way it prints a `Service URL` like `https://methane-frontend-xxxx-uc.a.run.app` — that's your app.

---

## 2. Verify

```bash
FRONTEND_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')

# Static app loads:
curl -sI "$FRONTEND_URL/" | head -1                       # → HTTP/2 200

# Proxy → backend health:
curl -s "$FRONTEND_URL/api/health"                        # → {"status":"ok","model_loaded":true,...}
```
Then open `$FRONTEND_URL` in a browser: the status pill should go **WAKING → BACKEND READY**, and
**Capture & analyze** should run a real prediction. In DevTools → Network, confirm requests go to
`/api/predict` on your own origin.

---

## 3. Custom domain (optional)

Simplest path — Cloud Run domain mapping (managed TLS):
```bash
gcloud beta run domain-mappings create \
  --service "$SERVICE_NAME" \
  --domain app.example.com \
  --region "$REGION"
```
Then add the DNS records it prints. (If domain mappings aren't available in your region, front the
service with an external HTTPS Load Balancer instead.)

---

## 4. Updating

- **New frontend code** (HTML/JS/Caddyfile): re-run **step 1**. Each deploy is a new revision;
  traffic shifts automatically.
- **New backend URL**: edit `BACKEND_URL` in `.env`, then either re-run `./deploy.sh` or:
  ```bash
  gcloud run services update "$SERVICE_NAME" --region "$REGION" \
    --update-env-vars "BACKEND_URL=${BACKEND_URL}"
  ```

---

## 5. Test locally before deploying (optional)

Reproduce the exact same-origin topology with Docker + a mock backend:
```bash
# Terminal A — a mock backend on :8080 (health + predict). Any stub that matches BACKEND_API.md works.
# Terminal B — build & run the frontend container, pointing it at the mock:
docker build -t methane-frontend .
docker run --rm -p 8000:8080 \
  -e BACKEND_URL=http://host.docker.internal:8080 \
  methane-frontend
# Open http://localhost:8000
```
Without Docker, you can instead set `API_BASE` in [config.js](config.js) to a backend you can reach
directly (that backend would then need to send CORS headers itself).

---

## Notes

- **Backend deploy** is the model team's job — an unauthenticated Cloud Run service
  (`--allow-unauthenticated`). You only need its URL for `BACKEND_URL`.
- The container listens on `$PORT` (Cloud Run sets it; the Caddyfile defaults to `8080`).
- Full endpoint contract for the backend team: [BACKEND_API.md](BACKEND_API.md).
