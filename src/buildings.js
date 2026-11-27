import { ringGeodesicSqft } from "./area.js";
import {
  aroundBbox,
  bboxOfRings,
  expandBboxMeters,
  metersBetween,
  pointInPolygonRings,
  pointInRing,
  ringCentroid,
  stripClose,
} from "./geo.js";
import { fetchTimeout } from "./net.js";

/**
 * maps.mail.ru answered from Chrome with CORS. overpass.openstreetmap.fr
 * answered to curl but Chrome blocked it with no Access-Control-Allow-Origin.
 * overpass-api.de was at capacity.
 */
const SERVERS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const MIN_FOOTPRINT_SQFT = 60;

function parseWay(element) {
  if (element?.type !== "way" || !element.geometry || element.geometry.length < 4) return null;
  const ring = stripClose(element.geometry.map((point) => [point.lon, point.lat]));
  if (ring.length < 3) return null;
  return { id: element.id, ring };
}

export async function lookupBuildings(lng, lat, lotRings) {
  const bbox = lotRings?.length
    ? expandBboxMeters(bboxOfRings(lotRings), 20)
    : aroundBbox(lng, lat, 60);
  const query = `[out:json][timeout:18];
way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out geom;`;
  const errors = [];
  for (const server of SERVERS) {
    const host = new URL(server).host;
    try {
      const response = await fetchTimeout(
        server,
        { method: "POST", body: new URLSearchParams({ data: query }) },
        10000,
      );
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error("unexpected response");
      const buildings = data.elements
        .map(parseWay)
        .filter((building) => building && ringGeodesicSqft(building.ring) >= MIN_FOOTPRINT_SQFT);
      return { buildings, serverHost: host, errors };
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  return { buildings: [], serverHost: null, errors };
}

export function chooseHouse(buildings, lng, lat, lotRings) {
  const ranked = (buildings || [])
    .filter((building) => building?.ring?.length >= 3)
    .map((building) => {
      const center = ringCentroid(building.ring);
      return {
        ...building,
        containsPin: pointInRing(lng, lat, building.ring),
        onLot: Boolean(lotRings && center && pointInPolygonRings(center.lng, center.lat, lotRings)),
        dist: center ? metersBetween(lng, lat, center.lng, center.lat) : Infinity,
      };
    });
  const byDistance = (a, b) => a.dist - b.dist;
  let house = ranked.filter((building) => building.containsPin).sort(byDistance)[0] || null;
  if (!house) house = ranked.filter((building) => building.onLot).sort(byDistance)[0] || null;
  if (!house) house = ranked.filter((building) => building.dist < 30).sort(byDistance)[0] || null;
  const others = house
    ? ranked.filter((building) => building.id !== house.id && (building.onLot || building.containsPin))
    : [];
  return { house, others };
}
