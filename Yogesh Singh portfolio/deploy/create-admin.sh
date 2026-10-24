#!/usr/bin/env bash
# Run as root:  bash deploy/create-admin.sh "Yogesh Singh" admin@email.com 'a-strong-password'
set -euo pipefail
cd /opt/yogesh-portfolio
exec runuser -u portfolio -- env $(grep -Ev '^\s*(#|$)' /etc/yogesh-portfolio/env | xargs) node scripts/create-admin.js "$@"
