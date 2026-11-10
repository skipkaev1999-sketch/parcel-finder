#!/usr/bin/env bash
# Start PostGIS in Docker and load the downloaded GeoJSON layers in EPSG:3070.
# Usage: 03_load_postgis.sh <data_dir>
set -euo pipefail
export PROJ_DATA=/Applications/QGIS.app/Contents/Resources/qgis/proj
export GDAL_DATA=/Applications/QGIS.app/Contents/Resources/qgis/gdal
O=/Applications/QGIS.app/Contents/MacOS/ogr2ogr
PG='PG:host=127.0.0.1 port=55432 user=postgres password=demo dbname=parcels'
# imresamu/postgis is the multi-arch build of the official postgis image (arm64 for Apple Silicon).
docker run -d --name parcelmap-pg --memory 1g -e POSTGRES_PASSWORD=demo -e POSTGRES_DB=parcels \
  -p 127.0.0.1:55432:5432 imresamu/postgis:17-3.5 >/dev/null
until docker exec parcelmap-pg pg_isready -U postgres -d parcels >/dev/null 2>&1; do sleep 1; done
sleep 3
docker exec parcelmap-pg psql -U postgres -d parcels -qc "create extension if not exists postgis"
for L in parcels_raw lines substations solar flood; do
  "$O" -f PostgreSQL "$PG" "$1/$L.geojson" -nln "$L" -t_srs EPSG:3070 -lco GEOMETRY_NAME=geom \
    -lco OVERWRITE=YES -nlt PROMOTE_TO_MULTI
done
