#!/usr/bin/env bash
# Render every reel in reels.json: frames -> soundtrack -> normalised MP4.
# Usage: ./make_reels.sh [reel-name ...]    (default: all)
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="$(npm root -g)"
WORK="${WORK:-/tmp/devdha-reels}"
mkdir -p out "$WORK"
NAMES=("$@")
if [ ${#NAMES[@]} -eq 0 ]; then
  mapfile -t NAMES < <(python3 -c "import json;print('\n'.join(json.load(open('reels.json'))))")
fi
i=0
for n in "${NAMES[@]}"; do
  i=$((i+1))
  rm -rf "$WORK/$n"
  FILE=reels.html W=1080 H=1920 REEL="$n" node render.js 30 0 auto "$WORK/$n" 4 > /dev/null
  python3 audio_reels.py "$n" "$WORK/$n.wav"
  ffmpeg -v error -y -i "$WORK/$n.wav" -af "loudnorm=I=-14:TP=-1.5:LRA=11" -ar 44100 "$WORK/$n-norm.wav"
  ffmpeg -v error -y -framerate 30 -i "$WORK/$n/f%05d.png" -i "$WORK/$n-norm.wav" \
    -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest -movflags +faststart \
    "out/reel-$n-1080x1920.mp4"
  rm -rf "$WORK/$n"
  echo "done $n"
done
