/*
 * config.js — runtime configuration for the front-end.
 *
 * Loaded BEFORE app.js so app.js can read window.METHANE_CONFIG.
 * Edit this file per environment and re-deploy — no changes to app.js needed.
 *
 * SAME-ORIGIN SETUP: in production the front-end is served by a small Caddy
 * container that also reverse-proxies /api/* to the model backend (see Caddyfile).
 * Because of that:
 *   - API_BASE is a RELATIVE path ("/api"), so the browser only ever calls its
 *     own origin — no CORS.
 *   - The backend endpoints are unauthenticated (no API key).
 *
 * Local dev without the proxy: point API_BASE at a backend you can reach directly
 * (e.g. "http://localhost:8080"). Note that a direct cross-origin backend would
 * then need to send CORS headers itself.
 */
window.METHANE_CONFIG = {
  // Base path for the two model endpoints: `${API_BASE}/health` and `${API_BASE}/predict`.
  API_BASE: "/api",

  // Hard timeout (ms) for a /predict call. Cloud Run cold starts can be slow,
  // so keep this generous.
  PREDICT_TIMEOUT_MS: 60000,
};
