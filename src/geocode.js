import { fetchTimeout } from "./net.js";

const GEOCODE_URL =
  "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";

/** Bias and limit matches to the North Texas towns +P Services mows. */
const BIAS = "-96.86,33.22";
const SEARCH_EXTENT = "-97.25,32.95,-96.35,33.55";

const WEAK_TYPES = new Set(["Locality", "Postal", "POI"]);

function normalize(candidate) {
  const lng = Number(candidate?.location?.x);
  const lat = Number(candidate?.location?.y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return {
    label: candidate.address,
    score: Number(candidate.score) || 0,
    lng,
    lat,
    type: candidate.attributes?.Addr_type || "",
    city: candidate.attributes?.City || "",
  };
}

async function request(singleLine, restrict) {
  const params = new URLSearchParams({
    SingleLine: singleLine,
    f: "json",
    countryCode: "USA",
    maxLocations: "5",
    outFields: "Match_addr,Addr_type,City,Region,Postal",
    location: BIAS,
  });
  if (restrict) params.set("searchExtent", SEARCH_EXTENT);
  const response = await fetchTimeout(`${GEOCODE_URL}?${params}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Geocoder error");
  return (data.candidates || []).map(normalize).filter(Boolean);
}

export function isWeakMatch(candidate) {
  return WEAK_TYPES.has(candidate?.type);
}

/** A rooftop hit at score 100 should not make Erik pick between W and E Fifth. */
export function isAmbiguous(candidates) {
  if (!candidates || candidates.length < 2) return false;
  const [first, second] = candidates;
  const gap = first.score - second.score;
  if (first.score >= 99 && gap >= 1.5 && first.type === "PointAddress") return false;
  return gap < 3;
}

export async function searchAddress(text) {
  const query = text.trim();
  if (query.length < 4) throw new Error("Enter a street address.");
  const line = /\b(tx|texas)\b/i.test(query) ? query : `${query}, TX`;
  let candidates = await request(line, true);
  if (!candidates.length) candidates = await request(line, false);
  const typeRank = { PointAddress: 0, Subaddress: 1, StreetAddress: 2, StreetInt: 3 };
  candidates.sort(
    (a, b) => b.score - a.score || (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9),
  );
  return candidates;
}
