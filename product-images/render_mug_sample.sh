#!/usr/bin/env bash
# Sample: product 216 "11oz Photo Mug" (plain white) -> catalogue images on the brand-blue backdrop + zip
set -euo pipefail
cd "$(dirname "$0")"
PY="${BPY:?set BPY to a python that has bpy}"
export ASSETS="${ASSETS:?set ASSETS to the generated assets dir}"
OUT=out/216-11oz-photo-mug
rm -rf "$OUT"; mkdir -p "$OUT"
i=0
for v in front threequarter back top; do
  i=$((i+1))
  name="216-11oz-photo-mug_plain-white_0${i}-${v}.jpg"
  BG=navy RES=1200 SAMPLES=96 "$PY" -I sample_mug.py -- "$v" "$OUT/$name" > /dev/null 2>&1
  echo "done $name"
done
BG=sky RES=1200 SAMPLES=96 "$PY" -I sample_mug.py -- threequarter "$OUT/216-11oz-photo-mug_plain-white_05-threequarter-sky-backdrop.jpg" > /dev/null 2>&1
echo "done sky alt"
(cd out && rm -f ../devdha-product-images-sample.zip && zip -qr ../devdha-product-images-sample.zip 216-11oz-photo-mug)
ls -la devdha-product-images-sample.zip
