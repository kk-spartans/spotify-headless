FROM nixos/nix:latest AS builder

WORKDIR /build
COPY . .

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
ENV PATH="/opt/spotify-headless/bin:/opt/runtime/bin" \
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
  CMD ["/opt/runtime/bin/node", "/opt/runtime/share/spotify-headless/dist/healthcheck.js"]

ENTRYPOINT ["/opt/runtime/bin/node", "/opt/runtime/share/spotify-headless/dist/main.js"]
