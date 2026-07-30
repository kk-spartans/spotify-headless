#!/opt/runtime/bin/bash
set -euo pipefail

: "${ICECAST_ADMIN_PASSWORD:?ICECAST_ADMIN_PASSWORD is required}"
: "${ICECAST_SOURCE_PASSWORD:?ICECAST_SOURCE_PASSWORD is required}"
: "${VNC_PASSWORD:?VNC_PASSWORD is required}"
: "${SPOTIFY_DEVICE_NAME:?SPOTIFY_DEVICE_NAME is required}"
: "${AUTO_LOGIN_CLICK:=true}"
: "${WEBRTC_ADDITIONAL_HOST:?WEBRTC_ADDITIONAL_HOST is required}"
: "${WEBRTC_TAILSCALE_HOST:?WEBRTC_TAILSCALE_HOST is required}"

case "$ICECAST_ADMIN_PASSWORD$ICECAST_SOURCE_PASSWORD" in
  (*[!a-zA-Z0-9._-]*)
    echo "Icecast passwords contain invalid characters" >&2
    exit 2
    ;;
esac

case "$WEBRTC_ADDITIONAL_HOST$WEBRTC_TAILSCALE_HOST" in
  (*[!a-zA-Z0-9.:-]*)
    echo "WebRTC host addresses contain invalid characters" >&2
    exit 2
    ;;
esac

mkdir -p \
  "$HOME" \
  "$XDG_CACHE_HOME" \
  "$XDG_CONFIG_HOME" \
  "$XDG_CONFIG_HOME/applications" \
  "$XDG_DATA_HOME/applications" \
  "$XDG_RUNTIME_DIR" \
  /data/logs
chmod 700 "$HOME" "$XDG_RUNTIME_DIR"

case "$AUTO_LOGIN_CLICK" in
  (true|false) ;;
  (*)
    echo "AUTO_LOGIN_CLICK must be true or false" >&2
    exit 2
    ;;
esac

rm -f "$XDG_RUNTIME_DIR/first-run-login"
if test "$AUTO_LOGIN_CLICK" = true && test ! -e "$XDG_CONFIG_HOME/spotify/prefs"; then
  touch "$XDG_RUNTIME_DIR/first-run-login"
fi

cat > "$XDG_DATA_HOME/applications/spotify-auth-capture.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Spotify authorization URL capture
Exec=/opt/spotify-headless/bin/xdg-open %u
NoDisplay=true
Terminal=false
MimeType=x-scheme-handler/http;x-scheme-handler/https;
EOF

cat > "$XDG_CONFIG_HOME/mimeapps.list" <<'EOF'
[Default Applications]
x-scheme-handler/http=spotify-auth-capture.desktop
x-scheme-handler/https=spotify-auth-capture.desktop

[Added Associations]
x-scheme-handler/http=spotify-auth-capture.desktop;
x-scheme-handler/https=spotify-auth-capture.desktop;
EOF

for font_config in /nix/store/*fontconfig*/etc/fonts/fonts.conf; do
  if test -f "$font_config"; then
    export FONTCONFIG_FILE="$font_config"
    break
  fi
done

# Chromium leaves these transient locks behind after an unclean stop or when
# moving a profile between hosts. They contain no authentication state.
rm -f \
  "$XDG_RUNTIME_DIR/auth-url.txt" \
  "$XDG_CACHE_HOME/spotify/SingletonCookie" \
  "$XDG_CACHE_HOME/spotify/SingletonLock" \
  "$XDG_CACHE_HOME/spotify/SingletonSocket"

sed \
  -e "s/@ADMIN_PASSWORD@/$ICECAST_ADMIN_PASSWORD/g" \
  -e "s/@SOURCE_PASSWORD@/$ICECAST_SOURCE_PASSWORD/g" \
  /opt/spotify-headless/icecast.xml.template \
  > "$XDG_RUNTIME_DIR/icecast.xml"
chmod 600 "$XDG_RUNTIME_DIR/icecast.xml"

sed \
  -e "s/@WEBRTC_ADDITIONAL_HOST@/$WEBRTC_ADDITIONAL_HOST/g" \
  -e "s/@WEBRTC_TAILSCALE_HOST@/$WEBRTC_TAILSCALE_HOST/g" \
  /opt/spotify-headless/mediamtx.yml.template \
  > "$XDG_RUNTIME_DIR/mediamtx.yml"
chmod 600 "$XDG_RUNTIME_DIR/mediamtx.yml"

x11vnc -storepasswd "$VNC_PASSWORD" "$XDG_RUNTIME_DIR/vnc.pass" >/dev/null
chmod 600 "$XDG_RUNTIME_DIR/vnc.pass"

test ! -e /tmp/.X99-lock || rm /tmp/.X99-lock
test ! -e /tmp/.X11-unix/X99 || rm /tmp/.X11-unix/X99
test ! -e "$XDG_RUNTIME_DIR/dbus.sock" || rm "$XDG_RUNTIME_DIR/dbus.sock"

# Docker creates a missing bind-mount directory as root. Repair it here, then
# Supervisor permanently runs every workload process as the spotify user.
chown -R 1000:1000 /data

exec supervisord \
  --configuration /opt/spotify-headless/supervisord.conf \
  --nodaemon
