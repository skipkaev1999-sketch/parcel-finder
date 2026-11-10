#!/usr/bin/env bash
# Export processed PostGIS tables to GeoJSON (EPSG:4326) for tiling.
# Usage: 04_export.sh <out_dir>   (expects the parcelmap-pg container from 03_load_postgis.sh)
set -euo pipefail
export PROJ_DATA=/Applications/QGIS.app/Contents/Resources/qgis/proj
export GDAL_DATA=/Applications/QGIS.app/Contents/Resources/qgis/gdal
O=/Applications/QGIS.app/Contents/MacOS/ogr2ogr
PG='PG:host=127.0.0.1 port=55432 user=postgres password=demo dbname=parcels'
D="$1"; mkdir -p "$D"
OPT=(-t_srs EPSG:4326 -lco RFC7946=YES -lco COORDINATE_PRECISION=6 -overwrite)

# Land-use group from Wisconsin tax classes: 0 agricultural, 1 residential, 2 commercial/manufacturing,
# 3 forest (5M, 6 or Managed Forest Law W*), 4 undeveloped/other, 5 tax-exempt (X*), 6 unclassified.
"$O" -f GeoJSON "$D/parcels.geojson" "$PG" "${OPT[@]}" -nln parcels -sql "
select id, pid, town, cls, aux,
 case when cls ~ '(^|,)4(,|\$)' then 0
      when cls ~ '(^|,)1(,|\$)' then 1
      when cls ~ '(^|,)(2|3)(,|\$)' then 2
      when cls ~ '(^|,)(5M|6)(,|\$)' or aux like 'W%' or aux = 'AW' then 3
      when cls ~ '(^|,)(5|7)(,|\$)' then 4
      when aux like 'X%' then 5 else 6 end as cat,
 round(acres::numeric,1) as acres, round((line_m/1609.344)::numeric,2) as dl, line_kv as kv,
 round((sub_m/1609.344)::numeric,2) as ds, sub_name as sub, round((flood_share*100)::numeric)::int as fz,
 solar::int as sol, value as val,
 round(st_x(st_transform(st_pointonsurface(geom),4326))::numeric,5) as lon,
 round(st_y(st_transform(st_pointonsurface(geom),4326))::numeric,5) as lat,
 geom from parcels"
"$O" -f GeoJSON "$D/lines.geojson" "$PG" "${OPT[@]}" -nln lines -sql "select kv, nullif(operator,'') as op, geom from lines"
"$O" -f GeoJSON "$D/substations.geojson" "$PG" "${OPT[@]}" -nln substations -sql "select nullif(name,'') as name, voltage, geom from substations"
"$O" -f GeoJSON "$D/solar.geojson" "$PG" "${OPT[@]}" -nln solar -sql "select nullif(name,'') as name, nullif(output,'') as output, geom from solar"
"$O" -f GeoJSON "$D/flood.geojson" "$PG" "${OPT[@]}" -nln flood -sql "select 1 as sfha, geom from flood_parts"
ls -la "$D"
