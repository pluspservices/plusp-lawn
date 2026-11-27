import { ringGeodesicSqft } from "./area.js";
import { cleanText, geometryToRings, metersToPolygon, pointInPolygonRings } from "./geo.js";
import { fetchTimeout } from "./net.js";

/**
 * Collin CAD's hosted parcel layer answers attribute queries but rejects
 * spatial queries (HTTP 200 with "Unable to perform query"). The county
 * interactive map does spatial queries and returns the geo id, which we
 * use to read recorded acreage from Collin CAD.
 */
const COLLIN_PARCELS =
  "https://maps.collincountytx.gov/server/rest/services/InteractiveMap/Appraisal_District/MapServer/1/query";
const CCAD_PARCELS =
  "https://services2.arcgis.com/uXyoacYrZTPTKD3R/arcgis/rest/services/CCAD_Parcel_Feature_Set/FeatureServer/4/query";
const DENTON_CAD =
  "https://geo.dentoncad.com/arcgis/rest/services/LandRecords/Parcels_Appraisal/FeatureServer/1/query";
const DENTON_COUNTY =
  "https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0/query";

const SNAP_METERS = 35;

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function arcgisQuery(url, params) {
  const response = await fetchTimeout(`${url}?${new URLSearchParams(params)}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Parcel query failed");
  return data.features || [];
}

function pointParams(lng, lat, fields) {
  return {
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: fields,
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  };
}

function envelopeParams(lng, lat, meters, fields) {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    geometry: `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: fields,
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: "12",
    f: "geojson",
  };
}

function consider(features, lng, lat, maxMeters) {
  let best = null;
  for (const feature of features) {
    const rings = geometryToRings(feature.geometry, lng, lat);
    if (!rings) continue;
    const inside = pointInPolygonRings(lng, lat, rings);
    const distance = inside ? 0 : metersToPolygon(lng, lat, rings);
    if (!inside && distance > maxMeters) continue;
    const area = ringGeodesicSqft(rings[0]);
    const candidate = { feature, rings, inside, distance, area };
    if (
      !best ||
      candidate.distance < best.distance - 0.5 ||
      (Math.abs(candidate.distance - best.distance) <= 0.5 && candidate.area < best.area)
    ) {
      best = candidate;
    }
  }
  return best;
}

async function spatialParcel(url, lng, lat, fields) {
  let features = await arcgisQuery(url, pointParams(lng, lat, fields));
  let fromEnvelope = false;
  if (!features.length) {
    features = await arcgisQuery(url, envelopeParams(lng, lat, SNAP_METERS, fields));
    fromEnvelope = true;
  }
  const chosen = consider(features, lng, lat, fromEnvelope ? SNAP_METERS : 8);
  if (!chosen) return null;
  return chosen;
}

async function collinAcreage(geoId) {
  if (!/^[A-Za-z0-9-]+$/.test(geoId)) return null;
  const params = new URLSearchParams({
    where: `geoID='${geoId}'`,
    outFields: "geoID,landSizeAcres,landSizeSqft,situsConcat",
    returnGeometry: "false",
    f: "json",
  });
  const response = await fetchTimeout(`${CCAD_PARCELS}?${params}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || "Collin CAD query failed");
  return data.features?.[0]?.attributes || null;
}

async function loadCollin(lng, lat) {
  const chosen = await spatialParcel(COLLIN_PARCELS, lng, lat, "geo_id,PROP_ID,situs_disp");
  if (!chosen) return null;
  const props = chosen.feature.properties || {};
  const geoId = cleanText(props.geo_id);
  let recordedSqft = null;
  let recordedAcres = null;
  let acreageLabel = null;
  try {
    const attrs = await collinAcreage(geoId);
    if (attrs) {
      recordedSqft = numberOrNull(attrs.landSizeSqft);
      recordedAcres = numberOrNull(attrs.landSizeAcres);
      if (recordedSqft != null || recordedAcres != null) acreageLabel = "Collin CAD";
    }
  } catch {
    acreageLabel = null;
  }
  return {
    rings: chosen.rings,
    source: "collin",
    sourceLabel: "Collin County GIS",
    acreageLabel,
    geoId,
    propId: props.PROP_ID ?? null,
    situs: cleanText(props.situs_disp),
    recordedSqft,
    recordedAcres,
    snapped: !chosen.inside,
    snapMeters: chosen.distance,
    area: chosen.area,
  };
}

function withRecord(chosen, fields) {
  let recordedSqft = numberOrNull(fields.sqft);
  let recordedAcres = numberOrNull(fields.acres);
  if (recordedSqft == null && recordedAcres != null) recordedSqft = recordedAcres * 43560;
  if (recordedAcres == null && recordedSqft != null) recordedAcres = recordedSqft / 43560;
  return {
    rings: chosen.rings,
    source: fields.source,
    sourceLabel: fields.sourceLabel,
    acreageLabel: recordedSqft != null ? fields.acreageLabel : null,
    geoId: fields.geoId || "",
    propId: fields.propId ?? null,
    situs: cleanText(fields.situs),
    recordedSqft,
    recordedAcres,
    snapped: !chosen.inside,
    snapMeters: chosen.distance,
    area: chosen.area,
  };
}

async function loadDentonCad(lng, lat) {
  const chosen = await spatialParcel(
    DENTON_CAD,
    lng,
    lat,
    "pid,name,legalDescription,legalAcreage,land_sqft,lot",
  );
  if (!chosen) return null;
  const props = chosen.feature.properties || {};
  return withRecord(chosen, {
    source: "denton",
    sourceLabel: "Denton CAD",
    acreageLabel: "Denton CAD",
    sqft: props.land_sqft,
    acres: props.legalAcreage,
    geoId: props.pid != null ? String(props.pid) : "",
    propId: props.pid ?? null,
    situs: props.legalDescription,
  });
}

async function loadDentonCounty(lng, lat) {
  const chosen = await spatialParcel(
    DENTON_COUNTY,
    lng,
    lat,
    "prop_id,SITUS,LAND_SQFT,LEGAL_DESC,LOT",
  );
  if (!chosen) return null;
  const props = chosen.feature.properties || {};
  return withRecord(chosen, {
    source: "denton-county",
    sourceLabel: "Denton County GIS",
    acreageLabel: "Denton County GIS",
    sqft: props.LAND_SQFT,
    acres: null,
    geoId: props.prop_id != null ? String(props.prop_id) : "",
    propId: props.prop_id ?? null,
    situs: props.SITUS,
  });
}

export function pickParcel(candidates) {
  const pool = (candidates || []).filter(Boolean);
  const inside = pool.filter((parcel) => !parcel.snapped);
  const usable = inside.length ? inside : pool.filter((parcel) => parcel.snapMeters <= SNAP_METERS);
  usable.sort((a, b) => {
    if (a.snapped !== b.snapped) return Number(a.snapped) - Number(b.snapped);
    if (Math.abs(a.snapMeters - b.snapMeters) > 1) return a.snapMeters - b.snapMeters;
    const larger = Math.max(a.area, b.area, 1);
    if (Math.abs(a.area - b.area) / larger > 0.05) return a.area - b.area;
    const preference = (parcel) =>
      (parcel.recordedSqft == null ? 2 : 0) + (parcel.source === "denton-county" ? 1 : 0);
    return preference(a) - preference(b);
  });
  return usable[0] || null;
}

async function settle(loader) {
  try {
    return { parcel: await loader(), error: null };
  } catch (error) {
    return { parcel: null, error: error.message || "unavailable" };
  }
}

export async function lookupParcel(lng, lat) {
  const [collin, dentonCad, dentonCounty] = await Promise.all([
    settle(() => loadCollin(lng, lat)),
    settle(() => loadDentonCad(lng, lat)),
    settle(() => loadDentonCounty(lng, lat)),
  ]);
  const parcel = pickParcel([collin.parcel, dentonCad.parcel, dentonCounty.parcel]);
  const errors = [
    collin.error ? `Collin County: ${collin.error}` : null,
    dentonCad.error ? `Denton CAD: ${dentonCad.error}` : null,
    dentonCounty.error ? `Denton County: ${dentonCounty.error}` : null,
  ].filter(Boolean);
  return { parcel, errors };
}
