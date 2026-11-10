"""Download Iowa County, WI parcels from the Wisconsin V12 statewide parcel service.

Owner names and addresses are not requested. Output: one GeoJSON in EPSG:4326.
"""
import json
import ssl
import sys
import time
import urllib.parse
import urllib.request

SERVICE = ("https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/"
           "Wisconsin_Statewide_Parcels_DB/FeatureServer/0/query")
FIELDS = ["STATEID", "PARCELID", "PLACENAME", "PROPCLASS", "AUXCLASS",
          "ASSDACRES", "DEEDACRES", "GISACRES", "ESTFMKVALUE", "TAXROLLYEAR"]
PAGE = 2000
# python.org builds ship without CA certs; use the macOS bundle.
CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem")


def fetch(offset: int) -> dict:
    params = {
        "where": "CONAME='IOWA'",
        "outFields": ",".join(FIELDS),
        "outSR": "4326",
        "orderByFields": "OBJECTID",
        "resultOffset": str(offset),
        "resultRecordCount": str(PAGE),
        "f": "geojson",
    }
    url = SERVICE + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120, context=CTX) as r:
                return json.load(r)
        except Exception as e:  # network hiccup: retry with backoff
            print(f"offset {offset} attempt {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"failed at offset {offset}")


def main(out_path: str) -> None:
    features = []
    offset = 0
    while True:
        page = fetch(offset)
        feats = page.get("features", [])
        features.extend(feats)
        print(f"offset {offset}: {len(feats)}", file=sys.stderr)
        if len(feats) < PAGE:
            break
        offset += PAGE
    with open(out_path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f)
    print(f"saved {len(features)} parcels to {out_path}")


if __name__ == "__main__":
    main(sys.argv[1])
