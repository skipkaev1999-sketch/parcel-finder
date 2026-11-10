"""Context layers around Iowa County, WI.

- Transmission lines, substations, solar plants: OpenStreetMap via Overpass (ODbL).
- 1% annual chance flood zones (SFHA): FEMA NFHL as republished by the Wisconsin Department of
  Health Services (hazards.fema.gov resets connections from here).
The bbox is the county plus a margin, so the nearest line can sit across the border.
"""
import json
import ssl
import sys
import time
import urllib.parse
import urllib.request

CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem")
S, W, N, E = 42.66, -90.58, 43.36, -89.69  # county bbox plus ~12 km


def get(url: str, data: bytes | None = None, timeout: int = 180) -> dict:
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "parcel-map-portfolio-demo"})
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
                return json.load(r)
        except Exception as e:
            print(f"attempt {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"failed: {url[:120]}")


def ring_centroid(coords):
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return [sum(xs) / len(xs), sum(ys) / len(ys)]


def osm_layers(out_dir: str) -> None:
    bbox = f"({S},{W},{N},{E})"
    q = f"""[out:json][timeout:150];
(
  way["power"="line"]{bbox};
  node["power"="substation"]{bbox};
  way["power"="substation"]{bbox};
  way["power"="plant"]["plant:source"="solar"]{bbox};
  relation["power"="plant"]["plant:source"="solar"]{bbox};
);
out geom;"""
    d = get("https://overpass-api.de/api/interpreter", urllib.parse.urlencode({"data": q}).encode())
    lines, subs, solar = [], [], []
    for el in d["elements"]:
        t = el.get("tags", {})
        if t.get("power") == "line" and el["type"] == "way":
            geom = [[p["lon"], p["lat"]] for p in el["geometry"]]
            kv = t.get("voltage", "")
            lines.append({"type": "Feature", "properties": {"osm_id": el["id"], "voltage": kv,
                          "operator": t.get("operator", "")},
                          "geometry": {"type": "LineString", "coordinates": geom}})
        elif t.get("power") == "substation":
            if el["type"] == "node":
                pt = [el["lon"], el["lat"]]
            else:
                pt = ring_centroid([[p["lon"], p["lat"]] for p in el["geometry"]])
            subs.append({"type": "Feature", "properties": {"osm_id": el["id"], "name": t.get("name", ""),
                         "voltage": t.get("voltage", "")},
                         "geometry": {"type": "Point", "coordinates": pt}})
        elif t.get("power") == "plant":
            rings = []
            if el["type"] == "way":
                rings = [[[p["lon"], p["lat"]] for p in el["geometry"]]]
            else:
                for m in el.get("members", []):
                    if m.get("role") == "outer" and m.get("geometry"):
                        rings.append([[p["lon"], p["lat"]] for p in m["geometry"]])
            rings = [r for r in rings if len(r) >= 4 and r[0] == r[-1]]
            if rings:
                solar.append({"type": "Feature", "properties": {"osm_id": el["id"], "name": t.get("name", ""),
                              "output": t.get("plant:output:electricity", "")},
                              "geometry": {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}})
    for name, feats in (("lines", lines), ("substations", subs), ("solar", solar)):
        with open(f"{out_dir}/{name}.geojson", "w") as f:
            json.dump({"type": "FeatureCollection", "features": feats}, f)
        print(f"{name}: {len(feats)}")


def fema_flood(out_dir: str) -> None:
    base = "https://dhsgis.wi.gov/server/rest/services/DHS_RAFT/FEMA_NFHL/MapServer/0/query"
    feats, offset = [], 0
    while True:
        params = {
            "where": "1=1",
            "geometry": f"{W},{S},{E},{N}", "geometryType": "esriGeometryEnvelope", "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects", "outFields": "OBJECTID",
            "outSR": "4326", "maxAllowableOffset": "0.00003", "geometryPrecision": "6",
            "resultOffset": str(offset), "resultRecordCount": "500", "f": "geojson",
        }
        d = get(base + "?" + urllib.parse.urlencode(params), timeout=300)
        page = d.get("features", [])
        feats.extend(page)
        print(f"flood offset {offset}: {len(page)}", file=sys.stderr)
        if len(page) < 500 and not d.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += len(page)
        if not page:
            break
    with open(f"{out_dir}/flood.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    print(f"flood: {len(feats)}")


if __name__ == "__main__":
    out = sys.argv[1]
    if "--flood-only" not in sys.argv:
        osm_layers(out)
    fema_flood(out)
