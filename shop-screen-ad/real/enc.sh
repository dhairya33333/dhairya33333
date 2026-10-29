#!/bin/bash
cd "$(dirname "$0")"
for L in en hi mr; do ffmpeg -y -loglevel error -framerate 30 -i frames_$L/f%05d.jpg -c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p -movflags +faststart -an out/Devdha-The-Spark-$L.mp4; done
printf "file 'out/Devdha-The-Spark-en.mp4'\nfile 'out/Devdha-The-Spark-hi.mp4'\nfile 'out/Devdha-The-Spark-mr.mp4'\n" > list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i list.txt -c copy -movflags +faststart out/Devdha-The-Spark-3lang.mp4
echo ok > enc_done.txt
