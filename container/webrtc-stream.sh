#!/opt/runtime/bin/bash
set -euo pipefail

until pactl info >/dev/null 2>&1; do
  sleep 0.1
done

until curl --fail --silent --output /dev/null http://127.0.0.1:8889/spotify; do
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
  -b:a 96k \
  -vbr off \
  -application lowdelay \
  -frame_duration 10 \
  -ar 48000 \
  -ac 2 \
  -rtsp_transport tcp \
  -f rtsp \
  rtsp://127.0.0.1:8554/spotify
