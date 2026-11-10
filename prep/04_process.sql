-- All geometry is in EPSG:3070 (NAD83 / Wisconsin Transverse Mercator), units are metres.
-- 1 acre = 4046.8564224 m2, 1 mile = 1609.344 m.

-- Clean inputs and spatial indexes.
UPDATE parcels_raw SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom), 3)) WHERE NOT ST_IsValid(geom);
CREATE INDEX IF NOT EXISTS parcels_raw_gix ON parcels_raw USING gist (geom);
CREATE INDEX IF NOT EXISTS lines_gix ON lines USING gist (geom);
CREATE INDEX IF NOT EXISTS substations_gix ON substations USING gist (geom);

-- Flood zones come as a few huge multipolygons: clip to the county window and cut into small pieces.
DROP TABLE IF EXISTS flood_parts;
CREATE TABLE flood_parts AS
WITH win AS (SELECT ST_Expand(ST_SetSRID(ST_Extent(geom)::geometry, 3070), 2000) AS g FROM parcels_raw)
SELECT ST_Subdivide(ST_CollectionExtract(ST_Intersection(ST_MakeValid(f.geom), win.g), 3), 256) AS geom
FROM flood f, win
WHERE ST_Intersects(f.geom, win.g);
DELETE FROM flood_parts WHERE ST_IsEmpty(geom) OR NOT ST_IsValid(geom);
CREATE INDEX flood_parts_gix ON flood_parts USING gist (geom);

-- Transmission line voltage in kV (OSM stores volts, sometimes "138000;69000").
ALTER TABLE lines ADD COLUMN IF NOT EXISTS kv integer;
UPDATE lines SET kv = (SELECT max(v::numeric) / 1000
                       FROM regexp_split_to_table(nullif(voltage, ''), ';') v
                       WHERE v ~ '^[0-9]+$');

DROP TABLE IF EXISTS parcels;
CREATE TABLE parcels AS
SELECT
  row_number() OVER (ORDER BY p.stateid)::int AS id,
  p.parcelid AS pid,
  initcap(p.placename) AS town,
  coalesce(nullif(p.propclass, ''), 'none') AS cls,
  nullif(p.auxclass, '') AS aux,
  round((ST_Area(p.geom) / 4046.8564224)::numeric, 2) AS acres,
  p.assdacres AS acres_assessed,
  p.gisacres AS acres_state,
  p.estfmkvalue AS value,
  nl.dist_m AS line_m,
  nl.kv AS line_kv,
  ns.dist_m AS sub_m,
  ns.name AS sub_name,
  coalesce((SELECT sum(ST_Area(ST_Intersection(p.geom, f.geom)))
            FROM flood_parts f WHERE ST_Intersects(p.geom, f.geom)), 0) / nullif(ST_Area(p.geom), 0) AS flood_share,
  EXISTS (SELECT 1 FROM solar s WHERE ST_Intersects(p.geom, s.geom)) AS solar,
  p.geom
FROM parcels_raw p
CROSS JOIN LATERAL (
  SELECT ST_Distance(p.geom, l.geom) AS dist_m, l.kv
  FROM lines l ORDER BY l.geom <-> p.geom LIMIT 1) nl
CROSS JOIN LATERAL (
  SELECT ST_Distance(p.geom, s.geom) AS dist_m, nullif(s.name, '') AS name
  FROM substations s ORDER BY s.geom <-> p.geom LIMIT 1) ns;

UPDATE parcels SET flood_share = least(flood_share, 1);
ALTER TABLE parcels ADD PRIMARY KEY (id);
CREATE INDEX parcels_gix ON parcels USING gist (geom);
