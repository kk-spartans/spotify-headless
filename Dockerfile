FROM nixos/nix:2.35.2 AS dependencies

SHELL ["/bin/sh", "-o", "pipefail", "-c"]
WORKDIR /build
COPY flake.nix flake.lock ./

RUN nix --extra-experimental-features "nix-command flakes" build \
      --out-link /tmp/runtime \
      .#runtimeDependencies \
    && mkdir -p /rootfs/nix/store /rootfs/opt/runtime /rootfs/bin \
    && nix-store --query --requisites /tmp/runtime > /tmp/runtime-paths \
    && xargs -a /tmp/runtime-paths -I '{}' cp -a '{}' /rootfs/nix/store/ \
    && cp -a /tmp/runtime/. /rootfs/opt/runtime/ \
    && ln -s /opt/runtime/bin/bash /rootfs/bin/sh \
    && printf '%s\n' \
      'root:x:0:0:root:/root:/opt/runtime/bin/bash' \
      'spotify:x:1000:1000:Spotify:/data/home:/opt/runtime/bin/bash' \
      'nonroot:x:65532:65532:nonroot:/nonexistent:/sbin/nologin' \
      > /rootfs/passwd \
    && printf '%s\n' \
      'root:x:0:' \
      'spotify:x:1000:' \
      'nonroot:x:65532:' \
      > /rootfs/group

FROM dependencies AS builder

RUN nix --extra-experimental-features "nix-command flakes" build \
      --out-link /tmp/build-tools \
      .#appBuildTools

COPY package.json tsconfig.json ./
COPY src/ ./src/
RUN /tmp/build-tools/bin/tsc -p tsconfig.json --noEmit --pretty false \
    && /tmp/build-tools/bin/esbuild src/main.ts src/auth-capture.ts src/healthcheck.ts \
      --bundle --platform=node --format=esm --outdir=/app/dist

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=dependencies /rootfs/nix/store/ /nix/store/
COPY --from=dependencies /rootfs/opt/runtime/ /opt/runtime/
COPY --from=dependencies /rootfs/bin/ /bin/
COPY --from=dependencies /rootfs/passwd /etc/passwd
COPY --from=dependencies /rootfs/group /etc/group
ENV PATH="/opt/spotify-headless/bin:/opt/runtime/bin" \
    BROWSER="/opt/spotify-headless/bin/xdg-open" \
    DISPLAY=":99" \
    HOME="/data/home" \
    XDG_CACHE_HOME="/data/cache" \
    XDG_CONFIG_HOME="/data/config" \
    XDG_DATA_HOME="/data/share" \
    XDG_RUNTIME_DIR="/data/run" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

# Container starts as root to prepare /data permissions, then drops to UID 1000.
# hadolint ignore=DL3002
USER 0:0
WORKDIR /data

EXPOSE 8080 8189/udp

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["/opt/runtime/bin/node", "/opt/runtime/share/spotify-headless/dist/healthcheck.js"]

COPY --from=builder /app/ /opt/runtime/share/spotify-headless/
# URL capture shim (named xdg-open so the Spotify client finds it on PATH).
COPY --chmod=755 container/xdg-open /opt/spotify-headless/bin/xdg-open
ENTRYPOINT ["/opt/runtime/bin/node", "/opt/runtime/share/spotify-headless/dist/main.js"]
