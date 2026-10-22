#!/usr/bin/env bash
# Render every physical-product shot (resumable). Needs BPY (python with bpy) and ASSETS.
set -uo pipefail
cd "$(dirname "$0")"
export SKIP_EXISTING=1 RES="${RES:-1000}" SAMPLES="${SAMPLES:-40}" ERRLOG="out/all/errors.log"
"${BPY:?}" -I shoot.py -- out/all/jobs.json
