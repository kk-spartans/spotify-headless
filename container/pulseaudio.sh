#!/opt/runtime/bin/bash
set -euo pipefail

for pulse_config in /nix/store/*pulseaudio*/etc/pulse/default.pa; do
  if test -f "$pulse_config"; then
    exec pulseaudio \
      --daemonize=no \
      --exit-idle-time=-1 \
      --file="$pulse_config" \
      --load="module-null-sink sink_name=spotify_stream rate=48000 channels=2 sink_properties=device.description=Spotify_Stream"
  fi
done

echo "PulseAudio default.pa was not found in the runtime closure" >&2
exit 1
