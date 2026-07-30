#!/opt/runtime/bin/bash
set -euo pipefail

marker="$XDG_RUNTIME_DIR/first-run-login"
test -e "$marker" || exit 0

window=""
for _ in $(seq 1 60); do
  window="$(xdotool search --onlyvisible --class spotify 2>/dev/null | head -n 1 || true)"
  test -z "$window" || break
  sleep 1
done

if test -z "$window"; then
  echo "First-run login helper could not find the Spotify window" >&2
  exit 0
fi

# This is the center of Log in in Spotify's 839x629 first-run window.
xdotool windowactivate --sync "$window"
sleep 5
xdotool mousemove --window "$window" 210 343 click 1
rm -f "$marker"
echo "Clicked Spotify's first-run Log in button"
