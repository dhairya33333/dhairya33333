#!/bin/bash
# Re-render after editing content.js / offer.js:  ./build.sh
export NODE_PATH=$(npm root -g); cd "$(dirname "$0")"; rm -rf frames
node render.js 25 0 180 frames 4
./encode.sh
