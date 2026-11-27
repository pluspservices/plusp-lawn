/** Ring helpers. Coordinates are GeoJSON order: [longitude, latitude]. */

export function stripClose(ring) {
  const deduped = [];
  for (const point of ring || []) {
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const previous = deduped[deduped.length - 1];
    if (previous && previous[0] === lng && previous[1] === lat) continue;
    deduped.push([lng, lat]);
  }
  if (deduped.length > 1) {
    const first = deduped[0];
    const last = deduped[deduped.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) deduped.pop();
  }
  return deduped;
}

export function closeRing(ring) {
  const open = stripClose(ring);
  if (open.length < 3) return open;
  return [...open, [open[0][0], open[0][1]]];
}

export function pointInRing(lng, lat, ring) {
  const pts = stripClose(ring);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const crosses = yi > lat !== yj > lat;
    if (crosses && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point is inside the exterior ring and outside any holes. */
export function pointInPolygonRings(lng, lat, rings) {
  if (!rings?.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

export function ringCentroid(ring) {
  const pts = stripClose(ring);
  if (!pts.length) return null;
  let lng = 0;
  let lat = 0;
  for (const point of pts) {
    lng += point[0];
    lat += point[1];
  }
  return { lng: lng / pts.length, lat: lat / pts.length };
}

export function metersBetween(lng1, lat1, lng2, lat2) {
  const radius = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(a)));
}

function toLocalMeters(lng, lat, originLng, originLat) {
  const toRad = Math.PI / 180;
  return [
    (lng - originLng) * 111320 * Math.cos(originLat * toRad),
    (lat - originLat) * 111320,
  ];
}

function distanceToSegmentMeters(lng, lat, start, end) {
  const originLng = lng;
  const originLat = lat;
  const p = [0, 0];
  const a = toLocalMeters(start[0], start[1], originLng, originLat);
  const b = toLocalMeters(end[0], end[1], originLng, originLat);
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const denom = abx * abx + aby * aby || 1;
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / denom;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
}

export function metersToPolygon(lng, lat, rings) {
  if (pointInPolygonRings(lng, lat, rings)) return 0;
  let best = Infinity;
  for (const ring of rings || []) {
    const closed = closeRing(ring);
    for (let i = 0; i < closed.length - 1; i += 1) {
      best = Math.min(best, distanceToSegmentMeters(lng, lat, closed[i], closed[i + 1]));
    }
  }
  return best;
}

export function bboxOfRings(rings) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings || []) {
    for (const [lng, lat] of ring) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return { west, south, east, north };
}

export function expandBboxMeters(bbox, meters) {
  const midLat = (bbox.south + bbox.north) / 2;
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return {
    west: bbox.west - dLng,
    south: bbox.south - dLat,
    east: bbox.east + dLng,
    north: bbox.north + dLat,
  };
}

export function aroundBbox(lng, lat, meters) {
  return expandBboxMeters({ west: lng, east: lng, south: lat, north: lat }, meters);
}

export function geometryToRings(geometry, lng, lat) {
  if (!geometry) return null;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const sets = polygons
    .map((coordinates) => coordinates.map(stripClose).filter((ring) => ring.length >= 3))
    .filter((rings) => rings.length);
  if (!sets.length) return null;
  if (lng == null || lat == null) return sets[0];
  const containing = sets.find((rings) => pointInPolygonRings(lng, lat, rings));
  if (containing) return containing;
  let best = sets[0];
  let bestDistance = metersToPolygon(lng, lat, sets[0]);
  for (const rings of sets.slice(1)) {
    const distance = metersToPolygon(lng, lat, rings);
    if (distance < bestDistance) {
      best = rings;
      bestDistance = distance;
    }
  }
  return best;
}

export function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}
