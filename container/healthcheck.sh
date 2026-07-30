#!/opt/runtime/bin/bash
set -euo pipefail

curl --fail --silent --output /dev/null http://127.0.0.1:8080/vnc/vnc.html
curl --fail --silent --output /dev/null http://127.0.0.1:8080/auth/
curl --fail --silent --output /dev/null http://127.0.0.1:8080/spotify

for bitrate in 64 96 128; do
  curl \
    --fail \
    --silent \
    --max-time 1 \
    "http://127.0.0.1:8080/spotify-${bitrate}.opus" \
    --output /dev/null \
    || test "$?" -eq 28
done
