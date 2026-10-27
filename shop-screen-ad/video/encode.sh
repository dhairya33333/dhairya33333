#!/bin/bash
cd "$(dirname "$0")"; mkdir -p out
E="-c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -movflags +faststart -an"
ffmpeg -y -loglevel error -framerate 25 -i frames/f%05d.jpg $E out/Devdha-shop-screen-3lang-3min.mp4
for p in "en 0" "hi 1500" "mr 3000"; do set -- $p; ffmpeg -y -loglevel error -framerate 25 -start_number $2 -i frames/f%05d.jpg -frames:v 1500 $E out/Devdha-shop-screen-$1-60s.mp4; done
