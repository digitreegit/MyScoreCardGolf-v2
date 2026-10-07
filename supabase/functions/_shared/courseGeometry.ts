// Turns OpenStreetMap golf features into per-hole green targets (front / center / back).
// Pure TypeScript with no Deno or npm imports, so the app's Jest suite can test it directly.
//
// OSM model: each hole is a `golf=hole` way drawn tee → green (tags: ref = hole number, par,
// handicap); each green is a closed `golf=green` way.

export interface OsmPoint {
  lat: number;
  lon: number;
}

export interface OsmWay {
  type: 'way' | 'relation' | 'node';
  id: number;
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HoleTarget {
  hole_number: number;
  par: number;
  par_estimated: boolean;
  handicap: number | null;
  green_front: LatLng | null;
  green_center: LatLng;
  green_back: LatLng | null;
}

const M_PER_DEG_LAT = 111_320;
const GREEN_MATCH_METERS = 60; // hole line end must be on or near its green

/** Local flat projection around `origin`; accurate to well under a meter across a golf hole. */
function projector(origin: OsmPoint) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toXY: (p: OsmPoint) => ({ x: (p.lon - origin.lon) * mPerDegLon, y: (p.lat - origin.lat) * M_PER_DEG_LAT }),
    toLatLng: (x: number, y: number): LatLng => ({
      lat: round6(origin.lat + y / M_PER_DEG_LAT),
      lng: round6(origin.lon + x / mPerDegLon),
    }),
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type XY = { x: number; y: number };

function polygonCentroid(pts: XY[]): XY {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += cross;
    cx += (pts[j].x + pts[i].x) * cross;
    cy += (pts[j].y + pts[i].y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate polygon: fall back to the vertex average.
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const hit =
      poly[i].y > p.y !== poly[j].y > p.y &&
      p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x;
    if (hit) inside = !inside;
  }
  return inside;
}

const dist = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);

function minDistToPolygon(p: XY, poly: XY[]): number {
  if (pointInPolygon(p, poly)) return 0;
  return Math.min(...poly.map((v) => dist(p, v)));
}

function parseIntTag(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number.parseInt(v.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** Rough par from hole length when the `par` tag is missing (men's tees, typical US yardages). */
export function estimatePar(lengthMeters: number): number {
  if (lengthMeters < 230) return 3;
  if (lengthMeters < 430) return 4;
  return 5;
}

function lineLength(pts: XY[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

export interface GeometryResult {
  holes: HoleTarget[];
  skipped: Array<{ wayId: number; reason: string }>;
}

export function computeHoleTargets(elements: OsmWay[]): GeometryResult {
  const holeWays = elements.filter((e) => e.type === 'way' && e.tags?.golf === 'hole' && (e.geometry?.length ?? 0) >= 2);
  const greenWays = elements.filter((e) => e.type === 'way' && e.tags?.golf === 'green' && (e.geometry?.length ?? 0) >= 3);
  const skipped: GeometryResult['skipped'] = [];
  if (!holeWays.length) return { holes: [], skipped };

  const proj = projector(holeWays[0].geometry![0]);
  const greens = greenWays.map((g) => g.geometry!.map(proj.toXY));

  const byNumber = new Map<number, HoleTarget>();
  for (const way of holeWays) {
    const number = parseIntTag(way.tags?.ref);
    if (number == null || number < 1 || number > 36) {
      skipped.push({ wayId: way.id, reason: 'missing or invalid ref' });
      continue;
    }
    if (byNumber.has(number)) {
      // Multi-course facilities can repeat hole numbers inside one area; keep the first.
      skipped.push({ wayId: way.id, reason: `duplicate hole ${number}` });
      continue;
    }

    let line = way.geometry!.map(proj.toXY);
    const nearestGreen = (p: XY) => {
      let best = -1;
      let bestD = GREEN_MATCH_METERS;
      greens.forEach((g, i) => {
        const d = minDistToPolygon(p, g);
        if (d <= bestD) {
          bestD = d;
          best = i;
        }
      });
      return { index: best, d: bestD };
    };

    // Some ways are drawn green → tee; orient so the last point is at the green.
    const atEnd = nearestGreen(line[line.length - 1]);
    const atStart = nearestGreen(line[0]);
    if (atStart.index >= 0 && (atEnd.index < 0 || atStart.d < atEnd.d)) line = [...line].reverse();
    const green = nearestGreen(line[line.length - 1]);

    const end = line[line.length - 1];
    const approach = line[line.length - 2];
    const len = dist(approach, end) || 1;
    const dir = { x: (end.x - approach.x) / len, y: (end.y - approach.y) / len };

    let center = end;
    let front: LatLng | null = null;
    let back: LatLng | null = null;
    if (green.index >= 0) {
      const poly = greens[green.index];
      center = polygonCentroid(poly);
      const projections = poly.map((v) => (v.x - center.x) * dir.x + (v.y - center.y) * dir.y);
      const near = Math.min(...projections);
      const far = Math.max(...projections);
      front = proj.toLatLng(center.x + dir.x * near, center.y + dir.y * near);
      back = proj.toLatLng(center.x + dir.x * far, center.y + dir.y * far);
    }

    const parTag = parseIntTag(way.tags?.par);
    const validPar = parTag != null && parTag >= 3 && parTag <= 6;
    const handicap = parseIntTag(way.tags?.handicap);
    byNumber.set(number, {
      hole_number: number,
      par: validPar ? parTag : estimatePar(lineLength(line)),
      par_estimated: !validPar,
      handicap: handicap != null && handicap >= 1 && handicap <= 18 ? handicap : null,
      green_front: front,
      green_center: proj.toLatLng(center.x, center.y),
      green_back: back,
    });
  }

  return { holes: [...byNumber.values()].sort((a, b) => a.hole_number - b.hole_number), skipped };
}
