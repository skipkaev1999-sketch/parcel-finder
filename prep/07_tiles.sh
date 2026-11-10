#!/usr/bin/env bash
# Build one PMTiles file with all layers. Usage: 07_tiles.sh <export_dir> <site_dir>
set -euo pipefail
cd "$1"
tippecanoe -q -o "$2/data/iowa.pmtiles" --force -n "Iowa County WI parcels" \
  -A "Parcels: Wisconsin State Cartographer's Office V12 · Power: © OpenStreetMap contributors · Flood: FEMA NFHL" \
  -Z9 -z14 --detect-shared-borders --no-tile-size-limit --use-attribute-for-id=id \
  -L parcels:parcels_tiles.geojson -L lines:lines.geojson -L substations:substations.geojson \
  -L solar:solar.geojson -L flood:flood.geojson
