#!/bin/bash
cd "$(dirname "$0")"; mkdir -p out
O="-c:v libx264 -preset veryfast -crf 19 -pix_fmt yuv420p -movflags +faststart -an"
ffmpeg -y -loglevel error -framerate 30 -i frames/f%05d.jpg $O out/Devdha-shop-loop-3lang.mp4
n=0; for p in en hi mr; do ffmpeg -y -loglevel error -framerate 30 -start_number $((n*3375)) -i frames/f%05d.jpg -frames:v 3375 $O out/Devdha-shop-loop-$p.mp4; n=$((n+1)); done
