FROM nixos/nix:latest AS builder

WORKDIR /build
COPY flake.nix flake.lock ./

RUN nix --extra-experimental-features "nix-command flakes" build \
      --out-link /tmp/runtime \
      .#runtime \
    && mkdir -p /rootfs/nix/store /rootfs/opt \
    && cp -a $(nix-store --query --requisites /tmp/runtime) /rootfs/nix/store/ \
    && cp -a /tmp/runtime /rootfs/opt/runtime \
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

FROM gcr.io/distroless/base-debian12:nonroot

COPY --from=builder /rootfs/nix/store/ /nix/store/
COPY --from=builder /rootfs/opt/runtime /opt/runtime
COPY --from=builder /tmp/runtime/bin/bash /bin/sh
COPY --from=builder /rootfs/passwd /etc/passwd
COPY --from=builder /rootfs/group /etc/group
COPY --chmod=755 container/entrypoint.sh container/healthcheck.sh container/pulseaudio.sh container/stream.sh container/webrtc-stream.sh container/auto-login-click.sh /opt/spotify-headless/
COPY --chmod=755 container/xdg-open /opt/spotify-headless/bin/xdg-open
COPY --chmod=755 container/auth-server.py /opt/spotify-headless/auth-server.py
COPY container/supervisord.conf container/icecast.xml.template container/mediamtx.yml.template container/nginx.conf /opt/spotify-headless/

ENV PATH="/opt/spotify-headless/bin:/opt/runtime/bin" \
    BROWSER="/opt/spotify-headless/bin/xdg-open" \
    DISPLAY=":99" \
    HOME="/data/home" \
    XDG_CACHE_HOME="/data/cache" \
    XDG_CONFIG_HOME="/data/config" \
    XDG_DATA_HOME="/data/share" \
    XDG_RUNTIME_DIR="/data/run" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

USER 0:0
WORKDIR /data

EXPOSE 8080 8189/udp

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["/opt/spotify-headless/healthcheck.sh"]

ENTRYPOINT ["/opt/spotify-headless/entrypoint.sh"]
