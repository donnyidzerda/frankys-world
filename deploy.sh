#!/usr/bin/env bash
# Deploy = git pull. Static files only — nginx serves the repo directly.
# To push an update to installed iPads: bump the CACHE version in sw.js
# (e.g. frankys-world-v132 → v133) in the same commit as your change.
set -euo pipefail
cd "$(dirname "$0")"
git pull
echo "Deployed. (No build, no restart — nginx serves these files as-is.)"
