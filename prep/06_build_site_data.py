"""Turn exported GeoJSON into the files the static site loads.

- parcels_tiles.geojson: input for tippecanoe (card fields only, no centroids)
- site/data/table.json: one compact row per parcel for filters and counts in the browser
- site/data/chunks/*.json: full-precision geometry in an 8x8 grid, fetched only for KML/GeoJSON export
- site/data/meta.json: extent, grid and data dates
Usage: 05_build_site_data.py <export_dir> <site_dir>
"""
import json
import os
import sys

GRID = 8
TILE_KEYS = ["id", "cat", "acres", "dl", "ds", "fz", "sol", "pid", "town", "cls", "val", "kv", "sub"]
TABLE_COLS = ["id", "cat", "acres", "dl", "ds", "fz", "sol", "lon", "lat"]
EXPORT_KEYS = ["pid", "town", "cls", "acres", "dl", "kv", "ds", "sub", "fz", "val"]


def main(src: str, site: str) -> None:
    with open(os.path.join(src, "parcels.geojson")) as f:
        fc = json.load(f)
    feats = fc["features"]
    lons = [ft["properties"]["lon"] for ft in feats]
    lats = [ft["properties"]["lat"] for ft in feats]
    x0, x1, y0, y1 = min(lons), max(lons), min(lats), max(lats)
    pad = 1e-6
    dx, dy = (x1 - x0 + pad) / GRID, (y1 - y0 + pad) / GRID

    tiles, rows, chunks = [], [], {}
    for ft in feats:
        p = ft["properties"]
        tiles.append({"type": "Feature", "properties": {k: p.get(k) for k in TILE_KEYS},
                      "geometry": ft["geometry"]})
        rows.append([p[k] for k in TABLE_COLS])
        cx = min(int((p["lon"] - x0) / dx), GRID - 1)
        cy = min(int((p["lat"] - y0) / dy), GRID - 1)
        chunks.setdefault(f"{cx}_{cy}", {})[str(p["id"])] = {
            "p": {k: p.get(k) for k in EXPORT_KEYS}, "g": ft["geometry"]}

    with open(os.path.join(src, "parcels_tiles.geojson"), "w") as f:
        json.dump({"type": "FeatureCollection", "features": tiles}, f, separators=(",", ":"))

    data = os.path.join(site, "data")
    os.makedirs(os.path.join(data, "chunks"), exist_ok=True)
    with open(os.path.join(data, "table.json"), "w") as f:
        json.dump({"cols": TABLE_COLS, "rows": rows}, f, separators=(",", ":"))
    for key, items in chunks.items():
        with open(os.path.join(data, "chunks", f"{key}.json"), "w") as f:
            json.dump(items, f, separators=(",", ":"))
    meta = {"count": len(rows), "bbox": [x0, y0, x1, y1],
            "grid": {"n": GRID, "x0": x0, "y0": y0, "dx": dx, "dy": dy}}
    with open(os.path.join(data, "meta.json"), "w") as f:
        json.dump(meta, f)
    print(f"{len(rows)} parcels, {len(chunks)} chunks, bbox {x0:.4f},{y0:.4f},{x1:.4f},{y1:.4f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
