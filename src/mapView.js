import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { metersBetween, stripClose } from "./geo.js";

const STYLES = {
  lot: { color: "#e7f6d4", weight: 3, fillColor: "#3f8f4a", fillOpacity: 0.3 },
  house: { color: "#ffe0bf", weight: 2, fillColor: "#c46a2f", fillOpacity: 0.55 },
  roof: { color: "#ffe0bf", weight: 2, dashArray: "5 4", fillColor: "#c46a2f", fillOpacity: 0.4 },
  driveway: { color: "#f4f4f2", weight: 2, fillColor: "#6e6e6a", fillOpacity: 0.65 },
  patio: { color: "#fff1cc", weight: 2, fillColor: "#d7b56a", fillOpacity: 0.62 },
  pool: { color: "#d7f3ff", weight: 2, fillColor: "#2b8cbf", fillOpacity: 0.55 },
  beds: { color: "#d8f3c5", weight: 2, fillColor: "#1f4d32", fillOpacity: 0.5 },
};

let extraSerial = 1;

function pinIcon() {
  return L.divIcon({
    className: "pin",
    html: "<span></span>",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function vertexIcon(active) {
  return L.divIcon({
    className: active ? "vertex on" : "vertex",
    html: "<span></span>",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function latLngRings(rings) {
  return rings.map((ring) => stripClose(ring).map(([lng, lat]) => [lat, lng]));
}

function pointSegmentDistance(point, start, end) {
  const abx = end.x - start.x;
  const aby = end.y - start.y;
  const denom = abx * abx + aby * aby || 1;
  let t = ((point.x - start.x) * abx + (point.y - start.y) * aby) / denom;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (start.x + t * abx), point.y - (start.y + t * aby));
}

export function createMap(element, onUpdate) {
  const map = L.map(element, {
    zoomControl: false,
    attributionControl: true,
    doubleClickZoom: false,
    boxZoom: false,
  }).setView([33.22, -96.86], 11);

  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      maxZoom: 19,
      maxNativeZoom: 19,
    },
  ).addTo(map);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Labels © Esri",
      maxZoom: 19,
      maxNativeZoom: 19,
      opacity: 0.9,
    },
  ).addTo(map);

  const shapeLayer = L.featureGroup().addTo(map);
  const draftLayer = L.featureGroup().addTo(map);
  const handleLayer = L.featureGroup().addTo(map);
  const polygonLayers = new Map();

  let pin = null;
  let shapes = { lot: null, house: null, extras: [] };
  let draft = null;
  let selectedId = null;
  let editing = false;
  let selectedVertex = null;
  let suppressClick = false;

  function allShapes() {
    return [shapes.lot, shapes.house, ...shapes.extras].filter(Boolean);
  }

  function selectedShape() {
    return allShapes().find((shape) => shape.id === selectedId) || null;
  }

  function cloneRings(rings) {
    return (rings || []).map((ring) => ring.map((point) => [point[0], point[1]]));
  }

  function getShapes() {
    return {
      lot: shapes.lot ? cloneRings(shapes.lot.rings) : null,
      house: shapes.house ? cloneRings(shapes.house.rings) : null,
      extras: shapes.extras.map((extra) => ({
        id: extra.id,
        kind: extra.kind,
        rings: cloneRings(extra.rings),
      })),
    };
  }

  function emit() {
    const selected = selectedShape();
    onUpdate({
      draft: draft
        ? { kind: draft.kind, count: draft.points.length, canClose: draft.points.length >= 3 }
        : null,
      selected: selected
        ? {
            id: selected.id,
            kind: selected.kind,
            vertex: selectedVertex,
            canDeleteVertex: selected.rings[0].length > 3 && selectedVertex != null,
          }
        : null,
      shapes: getShapes(),
    });
  }

  function storeRings(rings) {
    return (rings || []).map(stripClose).filter((ring) => ring.length >= 3);
  }

  function renderShapes() {
    shapeLayer.clearLayers();
    polygonLayers.clear();
    for (const shape of allShapes()) {
      const style = { ...(STYLES[shape.kind] || STYLES.beds) };
      if (shape.id === selectedId) style.weight = (style.weight || 2) + 2;
      const layer = L.polygon(latLngRings(shape.rings), style);
      layer.on("click", (event) => {
        L.DomEvent.stop(event);
        suppressClick = true;
        if (draft) return;
        selectedId = shape.id;
        editing = true;
        selectedVertex = null;
        renderShapes();
        renderHandles();
        emit();
      });
      layer.addTo(shapeLayer);
      polygonLayers.set(shape.id, layer);
    }
  }

  function renderHandles() {
    handleLayer.clearLayers();
    const shape = editing ? selectedShape() : null;
    if (!shape) return;
    const ring = shape.rings[0];
    ring.forEach((coord, index) => {
      const marker = L.marker([coord[1], coord[0]], {
        draggable: true,
        autoPan: false,
        icon: vertexIcon(index === selectedVertex),
        zIndexOffset: 800,
      });
      marker.on("click", (event) => {
        L.DomEvent.stop(event);
        suppressClick = true;
        selectedVertex = index;
        renderHandles();
        emit();
      });
      marker.on("dragstart", () => {
        suppressClick = true;
      });
      marker.on("drag", () => {
        const latLng = marker.getLatLng();
        ring[index] = [latLng.lng, latLng.lat];
        const layer = polygonLayers.get(shape.id);
        if (layer) layer.setLatLngs(latLngRings(shape.rings));
      });
      marker.on("dragend", () => {
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 50);
        emit();
      });
      marker.addTo(handleLayer);
    });
  }

  function renderDraft() {
    draftLayer.clearLayers();
    if (!draft?.points.length) return;
    const latLngs = draft.points.map(([lng, lat]) => [lat, lng]);
    const style = STYLES[draft.kind] || STYLES.lot;
    if (latLngs.length >= 2) {
      L.polyline(latLngs, { color: style.color, weight: 3, dashArray: "6 6" }).addTo(draftLayer);
    }
    if (latLngs.length >= 3) {
      L.polygon(latLngs, { ...style, fillOpacity: 0.2, dashArray: "6 6" }).addTo(draftLayer);
    }
    latLngs.forEach((latLng, index) => {
      L.circleMarker(latLng, {
        radius: index === 0 ? 8 : 5,
        color: "#ffffff",
        weight: 2,
        fillColor: index === 0 ? "#1f4d32" : style.fillColor,
        fillOpacity: 1,
      }).addTo(draftLayer);
    });
  }

  function renderAll() {
    renderShapes();
    renderHandles();
    renderDraft();
  }

  function removeShape(id) {
    if (shapes.lot?.id === id) shapes.lot = null;
    else if (shapes.house?.id === id) shapes.house = null;
    else shapes.extras = shapes.extras.filter((extra) => extra.id !== id);
  }

  function finishDraft() {
    if (!draft || draft.points.length < 3) return;
    const rings = [draft.points.map((point) => [point[0], point[1]])];
    let shape;
    if (draft.kind === "lot" || draft.kind === "house") {
      shape = { id: draft.kind, kind: draft.kind, rings };
      shapes[draft.kind] = shape;
    } else {
      shape = { id: `${draft.kind}-${extraSerial++}`, kind: draft.kind, rings };
      shapes.extras.push(shape);
    }
    draft = null;
    selectedId = shape.id;
    editing = true;
    selectedVertex = null;
    renderAll();
    emit();
  }

  function addDraftPoint(latLng) {
    const coord = [latLng.lng, latLng.lat];
    const last = draft.points[draft.points.length - 1];
    if (last && metersBetween(last[0], last[1], coord[0], coord[1]) < 1.5) return;
    if (draft.points.length >= 3) {
      const first = L.latLng(draft.points[0][1], draft.points[0][0]);
      const start = map.latLngToContainerPoint(first);
      const end = map.latLngToContainerPoint(latLng);
      if (start.distanceTo(end) < 22) {
        finishDraft();
        return;
      }
    }
    draft.points.push(coord);
    renderDraft();
    emit();
  }

  function insertOrSelect(latLng) {
    const shape = selectedShape();
    if (!shape) return false;
    const ring = shape.rings[0];
    const clickPoint = map.latLngToContainerPoint(latLng);
    let nearestVertex = { dist: Infinity, index: -1 };
    ring.forEach((coord, index) => {
      const point = map.latLngToContainerPoint(L.latLng(coord[1], coord[0]));
      const dist = point.distanceTo(clickPoint);
      if (dist < nearestVertex.dist) nearestVertex = { dist, index };
    });
    if (nearestVertex.dist < 18) {
      selectedVertex = nearestVertex.index;
      renderHandles();
      emit();
      return true;
    }
    const closed = [...ring, ring[0]];
    let best = { dist: Infinity, index: 0 };
    for (let i = 0; i < closed.length - 1; i += 1) {
      const start = map.latLngToContainerPoint(L.latLng(closed[i][1], closed[i][0]));
      const end = map.latLngToContainerPoint(L.latLng(closed[i + 1][1], closed[i + 1][0]));
      const dist = pointSegmentDistance(clickPoint, start, end);
      if (dist < best.dist) best = { dist, index: i };
    }
    if (best.dist > 28) return false;
    ring.splice(best.index + 1, 0, [latLng.lng, latLng.lat]);
    selectedVertex = best.index + 1;
    renderAll();
    emit();
    return true;
  }

  map.on("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (draft) {
      addDraftPoint(event.latlng);
      return;
    }
    if (editing && selectedShape()) {
      if (!insertOrSelect(event.latlng)) {
        selectedId = null;
        editing = false;
        selectedVertex = null;
        renderAll();
        emit();
      }
    }
  });

  new ResizeObserver(() => map.invalidateSize()).observe(element);

  function setPin(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (!pin) {
      pin = L.marker([lat, lng], {
        icon: pinIcon(),
        interactive: false,
        keyboard: false,
        zIndexOffset: 300,
      }).addTo(map);
    } else {
      pin.setLatLng([lat, lng]);
    }
    if (!allShapes().length) map.setView([lat, lng], 18);
  }

  function setLot(rings) {
    const stored = storeRings(rings);
    shapes.lot = stored.length ? { id: "lot", kind: "lot", rings: stored } : null;
    if (selectedId === "lot" && !shapes.lot) selectedId = null;
    renderAll();
    emit();
  }

  function setHouse(ringOrRings) {
    const rings = Array.isArray(ringOrRings?.[0]?.[0]) ? ringOrRings : ringOrRings ? [ringOrRings] : [];
    const stored = storeRings(rings);
    shapes.house = stored.length ? { id: "house", kind: "house", rings: stored } : null;
    renderAll();
    emit();
  }

  function setShapes({ lot, house, extras }) {
    shapes = {
      lot: lot ? { id: "lot", kind: "lot", rings: storeRings(lot) } : null,
      house: house ? { id: "house", kind: "house", rings: storeRings(house) } : null,
      extras: (extras || [])
        .map((extra) => ({
          id: extra.id,
          kind: extra.kind,
          rings: storeRings(extra.rings),
        }))
        .filter((extra) => extra.rings.length),
    };
    draft = null;
    selectedId = null;
    editing = false;
    selectedVertex = null;
    renderAll();
    emit();
  }

  function addExtras(items) {
    for (const item of items) {
      const rings = storeRings(item.rings);
      if (!rings.length) continue;
      shapes.extras.push({ id: item.id, kind: item.kind, rings });
    }
    renderShapes();
    emit();
  }

  function clearShapes() {
    shapes = { lot: null, house: null, extras: [] };
    draft = null;
    selectedId = null;
    editing = false;
    selectedVertex = null;
    renderAll();
    emit();
  }

  function fit() {
    const bounds = L.latLngBounds([]);
    for (const shape of allShapes()) {
      for (const ring of shape.rings) {
        for (const [lng, lat] of ring) bounds.extend([lat, lng]);
      }
    }
    if (pin) bounds.extend(pin.getLatLng());
    if (!bounds.isValid()) return;
    map.fitBounds(bounds.pad(0.18), {
      paddingTopLeft: [12, 58],
      paddingBottomRight: [12, 16],
      maxZoom: 19,
      animate: false,
    });
  }

  function begin(kind) {
    if (kind === "pan") {
      draft = null;
      selectedId = null;
      editing = false;
      selectedVertex = null;
      renderAll();
      emit();
      return;
    }
    if ((kind === "lot" || kind === "house") && shapes[kind]) {
      draft = null;
      selectedId = kind;
      editing = true;
      selectedVertex = null;
      renderAll();
      emit();
      return;
    }
    draft = { kind, points: [] };
    selectedId = null;
    editing = false;
    selectedVertex = null;
    renderAll();
    emit();
  }

  function undo() {
    if (!draft?.points.length) return;
    draft.points.pop();
    renderDraft();
    emit();
  }

  function closeDraft() {
    finishDraft();
  }

  function cancelDraft() {
    if (!draft) return;
    draft = null;
    renderDraft();
    emit();
  }

  function deleteSelected() {
    if (!selectedId) return;
    removeShape(selectedId);
    selectedId = null;
    editing = false;
    selectedVertex = null;
    renderAll();
    emit();
  }

  function deleteSelectedVertex() {
    const shape = selectedShape();
    if (!shape || selectedVertex == null || shape.rings[0].length <= 3) return;
    shape.rings[0].splice(selectedVertex, 1);
    selectedVertex = null;
    renderAll();
    emit();
  }

  function redrawSelected() {
    const shape = selectedShape();
    if (!shape) return;
    const kind = shape.kind;
    removeShape(shape.id);
    draft = { kind, points: [] };
    selectedId = null;
    editing = false;
    selectedVertex = null;
    renderAll();
    emit();
  }

  requestAnimationFrame(() => map.invalidateSize());
  emit();

  return {
    setPin,
    setLot,
    setHouse,
    setShapes,
    addExtras,
    clearShapes,
    fit,
    begin,
    undo,
    closeDraft,
    cancelDraft,
    deleteSelected,
    deleteSelectedVertex,
    redrawSelected,
    getShapes,
    invalidate() {
      map.invalidateSize();
    },
  };
}
