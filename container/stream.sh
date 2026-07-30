#!/opt/runtime/bin/bash
set -euo pipefail

bitrate="${1:?bitrate is required}"
mount="spotify-${bitrate}.opus"

until pactl info >/dev/null 2>&1; do
  sleep 0.1
done

until curl --fail --silent --output /dev/null http://127.0.0.1:8000/status-json.xsl; do
  sleep 0.1
done

exec ffmpeg \
  -nostdin \
  -hide_banner \
  -loglevel warning \
  -thread_queue_size 64 \
  -f pulse \
  -fragment_size 960 \
  -i spotify_stream.monitor \
  -vn \
  -c:a libopus \
  -b:a "${bitrate}k" \
  -vbr off \
  -application lowdelay \
  -frame_duration 10 \
  -flush_packets 1 \
  -page_duration 20000 \
  -content_type audio/ogg \
  -f ogg \
  "icecast://source:${ICECAST_SOURCE_PASSWORD}@127.0.0.1:8000/${mount}"
