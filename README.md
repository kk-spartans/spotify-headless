# Headless Spicetify streaming

A docker container that has the desktop spotify app (with spicetify) embedded, acts as a spotify connect device, and outputs audio over a webrtc and IceCast endpoint. Trust me, this is useful. Don't question it.

- read `docker-compose.yml` and edit env vars if you want to configure anything (especially webrtc hostnames)
- `docker compose up -d`
- captured login URL: <http://localhost:8080/auth/>
  - open the link
  - paste the redirect
- the device should show up in your spotify

| Format | URL | Intended use |
| --- | --- | --- |
| WebRTC Opus | <http://localhost:8080/spotify> | Lowest latency in a browser |
| Ogg Opus 64 kbps | <http://localhost:8080/spotify-64.opus> | Lowest bandwidth |
| Ogg Opus 96 kbps | <http://localhost:8080/spotify-96.opus> | Balanced |
| Ogg Opus 128 kbps | <http://localhost:8080/spotify-128.opus> | Highest quality |

Only TCP port 8080 is published for the web UI, login helper, and streams.
WebRTC also requires UDP port 8189 for its media connection. To publish a
different HTTP port, run with `HTTP_PORT=80 docker compose up -d`.
