# Headless Spicetify streaming

A Docker container with the desktop Spotify app (with Spicetify) embedded. It acts as a Spotify Connect device and exposes one low-latency WebRTC stream plus on-demand Ogg Opus streams.

> Doesn't support arm64 since spotify doesn't publish a linux app for it upstream.

The container runs Spotify inside Xvfb, but does not run VNC or noVNC. The root page has the same automated Log in click used during first boot. It also captures Spotify's authorization URL and keeps the callback form on that page.

```bash
mkdir spotify-headless
cd spotify-headless
curl https://raw.githubusercontent.com/kk-spartans/spotify-headless/refs/heads/main/docker-compose.yml -o docker-compose.yml
```

- read `docker-compose.yml` and edit env vars if you want to configure anything (especially webrtc hostnames)

```bash
docker compose up -d
```

- open <http://localhost:8080/>
- click **Click Log in** if Spotify needs another login attempt
- open the captured authorization URL, finish Spotify login, and paste the localhost callback into the same page
- the device should show up in your spotify

| Format | URL | Intended use |
| --- | --- | --- |
| WebRTC Opus | <http://localhost:8080/spotify> | Lowest latency in a browser |
| Ogg Opus | <http://localhost:8080/spotify-96.opus> | On-demand HTTP audio |

The bitrate in an Ogg Opus URL is clamped to `60..192` kbps. For example, `/spotify-32.opus` produces a 60 kbps stream and `/spotify-320.opus` produces a 192 kbps stream. The Icecast server and ffmpeg publisher are started only when an Ogg stream is requested, then stopped after the last client disconnects.

Only TCP port 8080 is published for the UI and streams. WebRTC also requires UDP port 8189 for its media connection. To publish a different HTTP port, run with `HTTP_PORT=80 docker compose up -d`.
