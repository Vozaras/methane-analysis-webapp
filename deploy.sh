#!/usr/bin/env bash
# Deploy the frontend Cloud Run service using values from .env.
# Usage:  ./deploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env from the repo root.
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; . "$SCRIPT_DIR/.env"; set +a
else
  echo "No .env found — copy .env.example to .env and fill it in." >&2
  exit 1
fi

# Require the variables the deploy needs.
: "${PROJECT_ID:?set PROJECT_ID in .env}"
: "${REGION:?set REGION in .env}"
: "${BACKEND_URL:?set BACKEND_URL in .env}"
SERVICE_NAME="${SERVICE_NAME:-methane-detection-app}"

gcloud config set project "$PROJECT_ID"

gcloud run deploy "$SERVICE_NAME" \
  --source "$SCRIPT_DIR" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars "BACKEND_URL=${BACKEND_URL}"

echo
echo "Service URL:"
gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)'
