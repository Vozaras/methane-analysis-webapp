# Front-end container: Caddy serving the static app + proxying /api/* to the backend.
# Build:  docker build -t methane-frontend .
# Run:    docker run -p 8080:8080 \
#           -e BACKEND_URL=https://methane-backend-xxxx.run.app methane-frontend
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html app.js config.js /srv/
