import geographiclib from "geographiclib-geodesic";
import polygonClipping from "polygon-clipping";
import { closeRing, stripClose } from "./geo.js";

const geod = geographiclib.Geodesic.WGS84;
export const SQFT_PER_SQM = 10.763910416709722;

/**
 * Signed-insensitive geodesic area of one ring, in square meters.
 * Uses GeographicLib on WGS84 (the same algorithm as PostGIS geography).
 */
export function ringGeodesicM2(ring) {
  const points = stripClose(ring);
  if (points.length < 3) return 0;
  const polygon = geod.Polygon(false);
  for (const [lng, lat] of points) polygon.AddPoint(lat, lng);
  const result = polygon.Compute(false, true);
  return Math.abs(result.area || 0);
}

export function ringGeodesicSqft(ring) {
  return ringGeodesicM2(ring) * SQFT_PER_SQM;
}

function polygonSqft(rings) {
  if (!rings?.length) return 0;
  let area = ringGeodesicSqft(rings[0]);
  for (let i = 1; i < rings.length; i += 1) area -= ringGeodesicSqft(rings[i]);
  return area;
}

export function multiGeodesicSqft(multiPolygon) {
  return (multiPolygon || []).reduce((sum, rings) => sum + polygonSqft(rings), 0);
}

/** Accept a ring, a polygon (rings), or a multipolygon. */
export function toMultiPolygon(input) {
  if (!input?.length) return [];
  if (typeof input[0][0] === "number") {
    const ring = closeRing(input);
    return ring.length >= 4 ? [[ring]] : [];
  }
  if (typeof input[0][0][0] === "number") {
    const rings = input.map(closeRing).filter((ring) => ring.length >= 4);
    return rings.length ? [rings] : [];
  }
  if (typeof input[0][0][0][0] === "number") {
    return input
      .map((polygon) => polygon.map(closeRing).filter((ring) => ring.length >= 4))
      .filter((polygon) => polygon.length);
  }
  return [];
}

/**
 * Lot, house, and extra areas, plus mowable turf.
 * Mowable turf is the lot minus the union of every subtraction, clipped to the lot
 * so overlaps and strokes that run outside the parcel are not subtracted twice.
 */
export function measure({ lot, house, extras } = {}) {
  const lotMulti = toMultiPolygon(lot);
  const lotSqft = multiGeodesicSqft(lotMulti);
  const pieces = [];
  if (house) pieces.push({ id: "house", kind: "house", rings: house });
  for (const extra of extras || []) pieces.push(extra);

  const parts = pieces.map((piece) => ({
    id: piece.id,
    kind: piece.kind,
    sqft: multiGeodesicSqft(toMultiPolygon(piece.rings)),
  }));

  if (!lotMulti.length) {
    return {
      lotSqft: 0,
      parts,
      subtractedSqft: 0,
      mowableSqft: 0,
      adjusted: false,
    };
  }

  const clips = pieces.map((piece) => toMultiPolygon(piece.rings)).filter((multi) => multi.length);
  if (!clips.length) {
    return { lotSqft, parts, subtractedSqft: 0, mowableSqft: lotSqft, adjusted: false };
  }

  try {
    let cut = clips[0];
    for (const clip of clips.slice(1)) cut = polygonClipping.union(cut, clip);
    const inside = polygonClipping.intersection(lotMulti, cut);
    const remain = polygonClipping.difference(lotMulti, cut);
    const subtractedSqft = Math.max(0, multiGeodesicSqft(inside));
    const raw = parts.reduce((sum, part) => sum + part.sqft, 0);
    return {
      lotSqft,
      parts,
      subtractedSqft,
      mowableSqft: Math.max(0, multiGeodesicSqft(remain)),
      adjusted: raw - subtractedSqft > Math.max(20, lotSqft * 0.01),
    };
  } catch {
    const raw = parts.reduce((sum, part) => sum + part.sqft, 0);
    return {
      lotSqft,
      parts,
      subtractedSqft: Math.min(lotSqft, raw),
      mowableSqft: Math.max(0, lotSqft - raw),
      adjusted: true,
    };
  }
}
