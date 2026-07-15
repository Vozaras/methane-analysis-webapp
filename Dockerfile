# Front-end container: Caddy serving the static app + proxying /api/* to the backend.
# Build:  docker build -t methane-frontend .
# Run:    docker run -p 8080:8080 \
#           -e BACKEND_URL=https://methane-backend-xxxx.run.app methane-frontend
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html app.js config.js gallery-data.js /srv/
# Demo scene assets (gallery-data.js above needs these). The dir may hold only
# .gitkeep until the real sNN_{rgb,ir}.png thumbnails are added — the app falls
# back to live ESRI tiles for any missing image.
COPY gallery/ /srv/gallery/
