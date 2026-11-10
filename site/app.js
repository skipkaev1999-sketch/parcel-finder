"use strict";

// Land-use groups built from Wisconsin tax classes in prep/04_export.sh.
const CATS = [
  { code: 0, label: "Agricultural", color: "#8bc34a" },
  { code: 1, label: "Residential", color: "#ff8a65" },
  { code: 2, label: "Commercial / industrial", color: "#ba68c8" },
  { code: 3, label: "Forest", color: "#2e7d32" },
  { code: 4, label: "Undeveloped / other", color: "#d4c38a" },
  { code: 5, label: "Tax-exempt / public", color: "#64b5f6" },
  { code: 6, label: "Unclassified", color: "#bdbdbd" },
];
const CLASS_NAMES = {
  "1": "residential", "2": "commercial", "3": "manufacturing", "4": "agricultural",
  "5": "undeveloped", "5M": "agricultural forest", "6": "productive forest", "7": "other",
};
const MATCH_COLOR = "#ffb000";
const SOLAR_PRESET = { cats: [0], amin: 40, amax: "", line: 1, sub: 5, flood: 10 };
// Column order of data/table.json rows.
const C = { id: 0, cat: 1, acres: 2, dl: 3, ds: 4, fz: 5, sol: 6, lon: 7, lat: 8 };

const state = {
  rows: [],
  byId: new Map(),
  meta: null,
  cats: new Set(CATS.map((c) => c.code)),
  area: null,
  drawing: false,
  draft: [],
  matches: [],
  chunks: new Map(),
};

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const emptyFC = () => ({ type: "FeatureCollection", features: [] });

// ---------- map ----------
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);
const tilesUrl = "pmtiles://" + new URL("data/iowa.pmtiles", location.href).href;
const usgs = (s) => `https://basemap.nationalmap.gov/arcgis/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`;
const catColor = ["match", ["get", "cat"], ...CATS.flatMap((c) => [c.code, c.color]), "#bdbdbd"];
const NONE = ["==", ["id"], -1]; // matches nothing; parcel ids start at 1

const map = new maplibregl.Map({
  container: "map",
  bounds: [[-90.43, 42.81], [-89.84, 43.21]],
  fitBoundsOptions: { padding: 24 },
  maxZoom: 18,
  attributionControl: { compact: true },
  style: {
    version: 8,
    sources: {
      imagery: { type: "raster", tiles: [usgs("USGSImageryTopo")], tileSize: 256, maxzoom: 16, attribution: "Basemap: USGS The National Map" },
      topo: { type: "raster", tiles: [usgs("USGSTopo")], tileSize: 256, maxzoom: 16, attribution: "Basemap: USGS The National Map" },
      data: {
        type: "vector", url: tilesUrl,
        attribution: "Parcels: Wisconsin SCO V12 · Power: © OpenStreetMap contributors · Flood: FEMA NFHL",
      },
      area: { type: "geojson", data: emptyFC() },
      imported: { type: "geojson", data: emptyFC() },
    },
    layers: [
      { id: "imagery", type: "raster", source: "imagery" },
      { id: "topo", type: "raster", source: "topo", layout: { visibility: "none" } },
      { id: "flood-fill", type: "fill", source: "data", "source-layer": "flood", layout: { visibility: "none" },
        paint: { "fill-color": "#2196f3", "fill-opacity": 0.35 } },
      { id: "flood-line", type: "line", source: "data", "source-layer": "flood", layout: { visibility: "none" },
        paint: { "line-color": "#1565c0", "line-width": 0.6 } },
      { id: "parcels-fill", type: "fill", source: "data", "source-layer": "parcels",
        paint: { "fill-color": catColor, "fill-opacity": 0.22 } },
      { id: "parcels-line", type: "line", source: "data", "source-layer": "parcels",
        paint: { "line-color": "#ffffff", "line-opacity": 0.55,
                 "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.15, 13, 0.6, 16, 1.2] } },
      { id: "parcels-match-fill", type: "fill", source: "data", "source-layer": "parcels", filter: NONE,
        paint: { "fill-color": MATCH_COLOR, "fill-opacity": 0.45 } },
      { id: "parcels-match-line", type: "line", source: "data", "source-layer": "parcels", filter: NONE,
        paint: { "line-color": MATCH_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 15, 2] } },
      { id: "solar-fill", type: "fill", source: "data", "source-layer": "solar",
        paint: { "fill-color": "#fbc02d", "fill-opacity": 0.55 } },
      { id: "solar-line", type: "line", source: "data", "source-layer": "solar",
        paint: { "line-color": "#f57f17", "line-width": 1.5 } },
      { id: "lines", type: "line", source: "data", "source-layer": "lines",
        paint: { "line-color": "#e5342b",
                 "line-width": ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 69], 69, 1.6, 138, 2.4, 345, 3.6] } },
      { id: "substations", type: "circle", source: "data", "source-layer": "substations",
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 6], "circle-color": "#ffffff",
                 "circle-stroke-color": "#6a1b9a", "circle-stroke-width": 2.5 } },
      { id: "selected-line", type: "line", source: "data", "source-layer": "parcels", filter: NONE,
        paint: { "line-color": "#00e5ff", "line-width": 3.5 } },
      { id: "area-fill", type: "fill", source: "area", filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
        paint: { "fill-color": "#1f6feb", "fill-opacity": 0.08 } },
      { id: "area-line", type: "line", source: "area",
        paint: { "line-color": "#1f6feb", "line-width": 2, "line-dasharray": [2, 1.5] } },
      { id: "imported-fill", type: "fill", source: "imported", filter: ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false],
        paint: { "fill-color": ["coalesce", ["get", "fill"], "#e040fb"], "fill-opacity": ["coalesce", ["get", "fill-opacity"], 0.3] } },
      { id: "imported-line", type: "line", source: "imported", filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], false, true],
        paint: { "line-color": ["coalesce", ["get", "stroke"], "#e040fb"], "line-width": 2 } },
      { id: "imported-point", type: "circle", source: "imported", filter: ["match", ["geometry-type"], ["Point", "MultiPoint"], true, false],
        paint: { "circle-radius": 6, "circle-color": ["coalesce", ["get", "marker-color"], "#e040fb"],
                 "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-right");

const LAYER_GROUPS = {
  parcels: ["parcels-fill", "parcels-line", "parcels-match-fill", "parcels-match-line", "selected-line"],
  lines: ["lines"],
  substations: ["substations"],
  solar: ["solar-fill", "solar-line"],
  flood: ["flood-fill", "flood-line"],
};

// ---------- filters ----------
function readFilters() {
  const num = (id) => {
    const v = $(id).value.trim();
    return v === "" || Number.isNaN(Number(v)) ? null : Number(v);
  };
  return { amin: num("f-amin"), amax: num("f-amax"), line: num("f-line"), sub: num("f-sub"), flood: num("f-flood") };
}

function isActive(f) {
  return state.cats.size < CATS.length || state.area !== null ||
    [f.amin, f.amax, f.line, f.sub, f.flood].some((v) => v !== null);
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function apply() {
  const f = readFilters();
  const ring = state.area;
  const out = [];
  for (const r of state.rows) {
    if (!state.cats.has(r[C.cat])) continue;
    if (f.amin !== null && r[C.acres] < f.amin) continue;
    if (f.amax !== null && r[C.acres] > f.amax) continue;
    if (f.line !== null && r[C.dl] > f.line) continue;
    if (f.sub !== null && r[C.ds] > f.sub) continue;
    if (f.flood !== null && r[C.fz] > f.flood) continue;
    if (ring && !pointInRing(r[C.lon], r[C.lat], ring)) continue;
    out.push(r);
  }
  state.matches = out;

  const active = isActive(f);
  let expr = NONE;
  if (active && ring) {
    expr = ["in", ["id"], ["literal", out.map((r) => r[C.id])]];
  } else if (active) {
    expr = ["all", ["in", ["get", "cat"], ["literal", [...state.cats]]]];
    if (f.amin !== null) expr.push([">=", ["get", "acres"], f.amin]);
    if (f.amax !== null) expr.push(["<=", ["get", "acres"], f.amax]);
    if (f.line !== null) expr.push(["<=", ["get", "dl"], f.line]);
    if (f.sub !== null) expr.push(["<=", ["get", "ds"], f.sub]);
    if (f.flood !== null) expr.push(["<=", ["get", "fz"], f.flood]);
  }
  if (map.getLayer("parcels-match-fill")) {
    map.setFilter("parcels-match-fill", expr);
    map.setFilter("parcels-match-line", expr);
    map.setPaintProperty("parcels-fill", "fill-opacity", active ? 0.08 : 0.22);
  }

  const acres = out.reduce((s, r) => s + r[C.acres], 0);
  $("r-count").textContent = fmt(out.length);
  $("r-acres").textContent = fmt(acres);
  document.querySelectorAll("[data-export]").forEach((b) => (b.disabled = out.length === 0));
  renderList();
}

function renderList() {
  const list = $("r-list");
  const top = [...state.matches].sort((a, b) => b[C.acres] - a[C.acres]).slice(0, 40);
  list.innerHTML = top.map((r) =>
    `<li data-id="${r[C.id]}"><div><b>${fmt(r[C.acres], 1)} ac</b> ${esc(CATS[r[C.cat]].label)}</div>` +
    `<span>${fmt(r[C.dl], 2)} mi to line</span></li>`).join("");
  if (state.matches.length > top.length) {
    list.insertAdjacentHTML("beforeend", `<li class="more">Largest ${top.length} shown. Export to get all ${fmt(state.matches.length)}.</li>`);
  }
}

function renderCats() {
  $("cats").innerHTML = CATS.map((c) =>
    `<button class="cat${state.cats.has(c.code) ? "" : " off"}" data-cat="${c.code}"><i style="background:${c.color}"></i>${c.label}</button>`).join("");
}

function renderLegend() {
  $("legend").innerHTML = CATS.map((c) => `<div><i style="background:${c.color}"></i>${c.label}</div>`).join("") +
    `<div><i style="background:${MATCH_COLOR}"></i>Matches filters</div>`;
}

// ---------- parcel card ----------
function chunkKey(lon, lat) {
  const g = state.meta.grid;
  const cx = Math.min(Math.floor((lon - g.x0) / g.dx), g.n - 1);
  const cy = Math.min(Math.floor((lat - g.y0) / g.dy), g.n - 1);
  return `${cx}_${cy}`;
}

async function getChunk(key) {
  if (!state.chunks.has(key)) {
    state.chunks.set(key, fetch(`data/chunks/${key}.json`).then((r) => {
      if (!r.ok) throw new Error(`chunk ${key}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return state.chunks.get(key);
}

async function parcelRecord(row) {
  const chunk = await getChunk(chunkKey(row[C.lon], row[C.lat]));
  return chunk[String(row[C.id])];
}

const townName = (t) => String(t || "").replace(/\b(Of|The)\b/g, (w) => w.toLowerCase());

function classText(cls) {
  if (!cls || cls === "none") return "none recorded";
  return cls.split(",").map((c) => `${c} ${CLASS_NAMES[c] || ""}`.trim()).join(", ");
}

function renderCard(row, p) {
  const cat = CATS[row[C.cat]];
  $("card-body").innerHTML = `
    <h3>Parcel ${esc(p.pid || "n/a")}</h3>
    <div class="sub">${esc(townName(p.town))} · ${esc(cat.label)}</div>
    <dl>
      <dt>Area</dt><dd>${fmt(row[C.acres], 1)} acres</dd>
      <dt>Tax classes</dt><dd>${esc(classText(p.cls))}</dd>
      <dt>Nearest transmission line</dt><dd>${fmt(row[C.dl], 2)} mi${p.kv ? ` · ${p.kv} kV` : ""}</dd>
      <dt>Nearest substation</dt><dd>${fmt(row[C.ds], 2)} mi${p.sub ? ` · ${esc(p.sub)}` : ""}</dd>
      <dt>In 1% flood zone</dt><dd>${row[C.fz]}% of parcel</dd>
      <dt>Solar plant</dt><dd>${row[C.sol] ? "overlaps this parcel" : "none"}</dd>
      <dt>Est. market value</dt><dd>${p.val ? "$" + fmt(p.val) : "n/a"}</dd>
    </dl>
    <div class="actions">
      <button class="btn small" id="card-kml">Download KML</button>
      <button class="btn small ghost" id="card-zoom">Zoom to parcel</button>
    </div>`;
  $("card").hidden = false;
  $("card-kml").onclick = async () => {
    const rec = await parcelRecord(row);
    download(buildKml([{ row, p: rec.p, g: rec.g }], `Parcel ${p.pid}`, ""), `parcel-${p.pid}.kml`,
      "application/vnd.google-earth.kml+xml");
  };
  $("card-zoom").onclick = async () => {
    const rec = await parcelRecord(row);
    map.fitBounds(bboxOf(rec.g), { padding: 80, maxZoom: 17 });
  };
}

async function select(id, fly) {
  const row = state.byId.get(id);
  if (!row) return;
  map.setFilter("selected-line", ["==", ["id"], id]);
  if (fly) map.flyTo({ center: [row[C.lon], row[C.lat]], zoom: Math.max(map.getZoom(), 14.5) });
  try {
    const rec = await parcelRecord(row);
    renderCard(row, rec.p);
  } catch (err) {
    $("card-body").textContent = `Could not load parcel details: ${err.message}`;
    $("card").hidden = false;
  }
}

function bboxOf(geom) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      x0 = Math.min(x0, c[0]); y0 = Math.min(y0, c[1]); x1 = Math.max(x1, c[0]); y1 = Math.max(y1, c[1]);
    } else c.forEach(walk);
  };
  if (geom.type === "GeometryCollection") geom.geometries.forEach((g) => walk(bboxOf(g)));
  else walk(geom.coordinates ?? geom);
  return [[x0, y0], [x1, y1]];
}

// ---------- drawing an area ----------
function setDrawing(on) {
  state.drawing = on;
  state.draft = [];
  $("draw-btn").textContent = on ? "Cancel drawing" : "Draw area";
  $("draw-btn").classList.toggle("active", on);
  $("draw-hint").hidden = !on;
  map.getCanvas().style.cursor = on ? "crosshair" : "";
  on ? map.doubleClickZoom.disable() : map.doubleClickZoom.enable();
  if (!on) showArea();
}

function showDraft(cursor) {
  const pts = cursor ? [...state.draft, cursor] : state.draft;
  const feats = [];
  if (pts.length >= 2) feats.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts } });
  if (pts.length >= 3) feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } });
  map.getSource("area").setData({ type: "FeatureCollection", features: feats });
}

function showArea() {
  const fc = emptyFC();
  if (state.area) fc.features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [state.area] } });
  map.getSource("area").setData(fc);
}

function finishDraw() {
  const pts = state.draft.filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
  if (pts.length < 3) return;
  state.area = [...pts, pts[0]];
  setDrawing(false);
  $("draw-clear").hidden = false;
  apply();
}

// ---------- export ----------
const FIELD_ORDER = [
  ["parcel_id", (it) => it.p.pid], ["town", (it) => townName(it.p.town)], ["land_use", (it) => CATS[it.row[C.cat]].label],
  ["tax_classes", (it) => it.p.cls], ["acres", (it) => it.row[C.acres]], ["line_mi", (it) => it.row[C.dl]],
  ["line_kv", (it) => it.p.kv ?? ""], ["substation_mi", (it) => it.row[C.ds]], ["substation", (it) => it.p.sub ?? ""],
  ["flood_pct", (it) => it.row[C.fz]], ["solar_plant", (it) => (it.row[C.sol] ? "yes" : "no")],
  ["est_value_usd", (it) => it.p.val ?? ""],
];

async function collect(rows) {
  const keys = [...new Set(rows.map((r) => chunkKey(r[C.lon], r[C.lat])))];
  await Promise.all(keys.map(getChunk));
  const out = [];
  for (const r of rows) {
    const rec = (await getChunk(chunkKey(r[C.lon], r[C.lat])))[String(r[C.id])];
    out.push({ row: r, p: rec.p, g: rec.g });
  }
  return out;
}

function filterSummary() {
  const f = readFilters();
  const parts = [];
  if (state.cats.size < CATS.length) parts.push([...state.cats].map((c) => CATS[c].label).join(" or "));
  if (f.amin !== null) parts.push(`at least ${f.amin} acres`);
  if (f.amax !== null) parts.push(`at most ${f.amax} acres`);
  if (f.line !== null) parts.push(`transmission line within ${f.line} mi`);
  if (f.sub !== null) parts.push(`substation within ${f.sub} mi`);
  if (f.flood !== null) parts.push(`at most ${f.flood}% in flood zone`);
  if (state.area) parts.push("inside a drawn area");
  return parts.length ? parts.join("; ") : "all parcels";
}

const xml = (s) => esc(s);
const kmlColor = (hex, alpha) => alpha + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);

function kmlGeometry(g) {
  const coords = (ring) => ring.map((c) => `${c[0]},${c[1]}`).join(" ");
  const poly = (rings) =>
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(rings[0])}</coordinates></LinearRing></outerBoundaryIs>` +
    rings.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${coords(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("") +
    `</Polygon>`;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polys.length === 1 ? poly(polys[0]) : `<MultiGeometry>${polys.map(poly).join("")}</MultiGeometry>`;
}

function buildKml(items, title, description) {
  const styles = CATS.map((c) =>
    `<Style id="cat${c.code}"><LineStyle><color>${kmlColor(c.color, "ff")}</color><width>1.5</width></LineStyle>` +
    `<PolyStyle><color>${kmlColor(c.color, "66")}</color></PolyStyle></Style>`).join("\n");
  const folders = CATS.map((c) => {
    const inCat = items.filter((it) => it.row[C.cat] === c.code);
    if (!inCat.length) return "";
    const marks = inCat.map((it) => {
      const data = FIELD_ORDER.map(([name, get]) => `<Data name="${name}"><value>${xml(get(it))}</value></Data>`).join("");
      const desc = `${townName(it.p.town)} · ${fmt(it.row[C.acres], 1)} acres · ${fmt(it.row[C.dl], 2)} mi to line`;
      return `<Placemark><name>${xml(it.p.pid)}</name><description>${xml(desc)}</description>` +
        `<styleUrl>#cat${c.code}</styleUrl><ExtendedData>${data}</ExtendedData>${kmlGeometry(it.g)}</Placemark>`;
    }).join("\n");
    return `<Folder><name>${xml(c.label)} (${inCat.length})</name>\n${marks}\n</Folder>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
<name>${xml(title)}</name>
<description>${xml(description)}</description>
${styles}
${folders}
</Document>
</kml>`;
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(content, filename, type) {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportAs(kind) {
  const rows = state.matches;
  if (!rows.length) return;
  const status = $("export-status");
  status.textContent = `Preparing ${fmt(rows.length)} parcels…`;
  try {
    const items = await collect(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `iowa-county-parcels-${stamp}`;
    const summary = filterSummary();
    if (kind === "geojson") {
      const fc = {
        type: "FeatureCollection",
        features: items.map((it) => ({
          type: "Feature", id: it.row[C.id],
          properties: Object.fromEntries(FIELD_ORDER.map(([n, get]) => [n, get(it)])),
          geometry: it.g,
        })),
      };
      download(JSON.stringify(fc), `${base}.geojson`, "application/geo+json");
    } else if (kind === "csv") {
      const head = [...FIELD_ORDER.map(([n]) => n), "lon", "lat"].join(",");
      const lines = items.map((it) =>
        [...FIELD_ORDER.map(([, get]) => csvCell(get(it))), it.row[C.lon], it.row[C.lat]].join(","));
      download([head, ...lines].join("\n"), `${base}.csv`, "text/csv");
    } else {
      const kml = buildKml(items, `Iowa County parcels (${fmt(items.length)})`, `Filters: ${summary}. Exported ${stamp}.`);
      if (kind === "kml") {
        download(kml, `${base}.kml`, "application/vnd.google-earth.kml+xml");
      } else {
        const zipped = fflate.zipSync({ "doc.kml": fflate.strToU8(kml) });
        download(new Blob([zipped], { type: "application/vnd.google-earth.kmz" }), `${base}.kmz`);
      }
    }
    status.textContent = `Exported ${fmt(items.length)} parcels as ${kind.toUpperCase()}.`;
  } catch (err) {
    status.textContent = `Export failed: ${err.message}`;
  }
}

// ---------- KML / KMZ import ----------
async function importFile(file) {
  let text;
  if (/\.kmz$/i.test(file.name)) {
    const files = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
    const name = Object.keys(files).find((n) => /\.kml$/i.test(n));
    if (!name) throw new Error("no .kml file inside this KMZ");
    text = fflate.strFromU8(files[name]);
  } else {
    text = await file.text();
  }
  const dom = new DOMParser().parseFromString(text, "text/xml");
  if (dom.getElementsByTagName("parsererror").length) throw new Error("the file is not valid KML");
  const fc = toGeoJSON.kml(dom);
  fc.features = fc.features.filter((f) => f.geometry);
  if (!fc.features.length) throw new Error("no features with geometry found");
  map.getSource("imported").setData(fc);
  map.fitBounds(bboxOf({ coordinates: fc.features.map((f) => bboxOf(f.geometry)) }), { padding: 60, maxZoom: 16 });
  const box = $("imported");
  box.hidden = false;
  box.innerHTML = "";
  box.append(`${file.name}: ${fc.features.length} features `);
  const rm = Object.assign(document.createElement("button"), { className: "link", textContent: "Remove" });
  rm.onclick = () => { map.getSource("imported").setData(emptyFC()); box.hidden = true; };
  box.append(rm);
}

// ---------- wiring ----------
function bindUi() {
  document.querySelectorAll("[data-base]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-base]").forEach((x) => x.classList.toggle("on", x === b));
    map.setLayoutProperty("imagery", "visibility", b.dataset.base === "imagery" ? "visible" : "none");
    map.setLayoutProperty("topo", "visibility", b.dataset.base === "topo" ? "visible" : "none");
  }));
  document.querySelectorAll("[data-layer]").forEach((cb) => cb.addEventListener("change", () => {
    for (const id of LAYER_GROUPS[cb.dataset.layer]) map.setLayoutProperty(id, "visibility", cb.checked ? "visible" : "none");
  }));
  $("cats").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    const code = Number(btn.dataset.cat);
    state.cats.has(code) ? state.cats.delete(code) : state.cats.add(code);
    renderCats();
    apply();
  });
  let t;
  ["f-amin", "f-amax", "f-line", "f-sub", "f-flood"].forEach((id) =>
    $(id).addEventListener("input", () => { clearTimeout(t); t = setTimeout(apply, 150); }));
  $("preset-solar").addEventListener("click", () => {
    state.cats = new Set(SOLAR_PRESET.cats);
    $("f-amin").value = SOLAR_PRESET.amin; $("f-amax").value = SOLAR_PRESET.amax;
    $("f-line").value = SOLAR_PRESET.line; $("f-sub").value = SOLAR_PRESET.sub; $("f-flood").value = SOLAR_PRESET.flood;
    renderCats();
    apply();
  });
  $("reset").addEventListener("click", () => {
    state.cats = new Set(CATS.map((c) => c.code));
    ["f-amin", "f-amax", "f-line", "f-sub", "f-flood"].forEach((id) => ($(id).value = ""));
    state.area = null;
    $("draw-clear").hidden = true;
    if (state.drawing) setDrawing(false);
    showArea();
    renderCats();
    apply();
  });
  $("draw-btn").addEventListener("click", () => setDrawing(!state.drawing));
  $("draw-clear").addEventListener("click", () => {
    state.area = null;
    $("draw-clear").hidden = true;
    showArea();
    apply();
  });
  document.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => exportAs(b.dataset.export)));
  $("r-list").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li) select(Number(li.dataset.id), true);
  });
  $("card-close").addEventListener("click", () => {
    $("card").hidden = true;
    map.setFilter("selected-line", NONE);
  });
  $("about-open").addEventListener("click", () => $("about").showModal());
  $("kml-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try { await importFile(file); } catch (err) { alert(`Could not open ${file.name}: ${err.message}`); }
  });

  map.on("click", (e) => {
    if (state.drawing) {
      const pt = [e.lngLat.lng, e.lngLat.lat];
      if (state.draft.length >= 3) {
        const first = map.project(state.draft[0]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 12) { finishDraw(); return; }
      }
      state.draft.push(pt);
      showDraft();
      return;
    }
    const imported = map.queryRenderedFeatures(e.point, { layers: ["imported-fill", "imported-line", "imported-point"] });
    if (imported.length) {
      const el = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = imported[0].properties.name || "Imported feature";
      el.append(b);
      new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      return;
    }
    const hit = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] })[0];
    if (hit && hit.id != null) select(Number(hit.id), false);
  });
  map.on("dblclick", (e) => {
    if (state.drawing && state.draft.length >= 3) { e.preventDefault(); finishDraw(); }
  });
  map.on("mousemove", (e) => {
    if (state.drawing) {
      if (state.draft.length) showDraft([e.lngLat.lng, e.lngLat.lat]);
      return;
    }
    const hit = map.queryRenderedFeatures(e.point, { layers: ["parcels-fill"] }).length;
    map.getCanvas().style.cursor = hit ? "pointer" : "";
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.drawing) setDrawing(false); });
}

async function init() {
  renderCats();
  renderLegend();
  const [table, meta] = await Promise.all([
    fetch("data/table.json").then((r) => r.json()),
    fetch("data/meta.json").then((r) => r.json()),
  ]);
  state.rows = table.rows;
  state.meta = meta;
  state.byId = new Map(table.rows.map((r) => [r[C.id], r]));
  bindUi();
  apply();
  if (!map.isStyleLoaded()) map.once("load", apply);
  // MapLibre opens the compact attribution by default; keep it folded on small screens.
  map.once("load", () => {
    if (innerWidth < 820) document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  });
}

init().catch((err) => {
  $("r-count").textContent = "error";
  $("export-status").textContent = `Could not load data: ${err.message}`;
});
