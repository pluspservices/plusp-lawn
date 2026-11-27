import "./style.css";
import { measure } from "./area.js";
import { chooseHouse, lookupBuildings } from "./buildings.js";
import { formatAcres, formatMoney, formatSqft } from "./format.js";
import { isAmbiguous, isWeakMatch, searchAddress } from "./geocode.js";
import { stripClose } from "./geo.js";
import { createMap } from "./mapView.js";
import { lookupParcel } from "./parcels.js";
import { DEFAULT_RATES, normalizeRates, quotePrices } from "./pricing.js";
import { customerQuote } from "./quoteText.js";
import { loadQuotes, loadRates, saveQuotes, saveRates } from "./storage.js";

const KIND_LABEL = {
  lot: "lot",
  house: "house",
  roof: "other roof",
  driveway: "driveway",
  patio: "patio",
  pool: "pool",
  beds: "beds",
};

const SUBTRACT_KINDS = ["driveway", "patio", "pool", "beds"];

const els = {
  app: document.querySelector("#app"),
  address: document.querySelector("#address"),
  find: document.querySelector("#find"),
  search: document.querySelector("#search"),
  status: document.querySelector("#status"),
  candidates: document.querySelector("#candidates"),
  hint: document.querySelector("#hint"),
  hintText: document.querySelector("#hint-text"),
  undo: document.querySelector("#undo-point"),
  closeShape: document.querySelector("#close-shape"),
  cancelDraw: document.querySelector("#cancel-draw"),
  deleteVertex: document.querySelector("#delete-vertex"),
  redraw: document.querySelector("#redraw-shape"),
  deleteShape: document.querySelector("#delete-shape"),
  mowable: document.querySelector("#mowable-value"),
  areas: document.querySelector("#areas"),
  adjust: document.querySelector("#adjust-note"),
  addRoofs: document.querySelector("#add-roofs"),
  prices: document.querySelector("#prices"),
  tier: document.querySelector("#tier-note"),
  copy: document.querySelector("#copy-quote"),
  save: document.querySelector("#save-quote"),
  sources: document.querySelector("#sources"),
  ratesDialog: document.querySelector("#rates-dialog"),
  ratesForm: document.querySelector("#rates-form"),
  quoteDialog: document.querySelector("#quote-dialog"),
  quoteTitle: document.querySelector("#quote-title"),
  quoteNote: document.querySelector("#quote-note"),
  quoteText: document.querySelector("#quote-text"),
  savedDialog: document.querySelector("#saved-dialog"),
  savedEmpty: document.querySelector("#saved-empty"),
  savedList: document.querySelector("#saved-list"),
};

let rates = loadRates();
let current = blankProperty();
let snapshot = emptySnapshot();
let applying = false;
let lookupToken = 0;

const map = createMap(document.querySelector("#map"), (next) => {
  snapshot = next;
  if (!applying) noteEdits();
  render();
});

function blankProperty() {
  return {
    place: null,
    parcel: null,
    lotOrigin: null,
    houseOrigin: null,
    loadedLot: null,
    loadedHouse: null,
    otherBuildings: [],
    buildingServer: null,
    buildingFailed: false,
  };
}

function emptySnapshot() {
  return { draft: null, selected: null, shapes: { lot: null, house: null, extras: [] } };
}

function sameGeometry(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function noteEdits() {
  if (!snapshot.shapes.lot) current.lotOrigin = null;
  else if (!current.lotOrigin) current.lotOrigin = "manual";
  if (!snapshot.shapes.house) current.houseOrigin = null;
  else if (!current.houseOrigin) current.houseOrigin = "manual";
}

function setStatus(message, kind = "") {
  els.status.textContent = message;
  els.status.className = kind ? `status ${kind}` : "status";
}

function setBusy(busy) {
  els.app.setAttribute("aria-busy", busy ? "true" : "false");
  els.find.disabled = busy;
  els.find.textContent = busy ? "Finding…" : "Find";
}

function hideCandidates() {
  els.candidates.hidden = true;
  els.candidates.replaceChildren();
}

function showCandidates(candidates) {
  els.candidates.replaceChildren();
  for (const candidate of candidates) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${candidate.label} · ${candidate.city || candidate.type} · ${Math.round(candidate.score)}`;
    button.addEventListener("click", () => {
      hideCandidates();
      runLookup(candidate);
    });
    item.append(button);
    els.candidates.append(item);
  }
  els.candidates.hidden = false;
}

function sqftByKind(measurement) {
  const totals = {};
  for (const part of measurement.parts) totals[part.kind] = (totals[part.kind] || 0) + part.sqft;
  return totals;
}

function areaRow(label, value, swatch, detail) {
  const row = document.createElement("div");
  row.className = "row";
  const term = document.createElement("dt");
  const chip = document.createElement("span");
  chip.className = `swatch ${swatch}`;
  term.append(chip, document.createTextNode(label));
  const amount = document.createElement("dd");
  amount.textContent = value;
  row.append(term, amount);
  if (detail) {
    const extra = document.createElement("dd");
    extra.className = "detail";
    extra.textContent = detail;
    row.append(extra);
  }
  return row;
}

function priceCard(label, amount, detail, wide = false) {
  const card = document.createElement("article");
  card.className = wide ? "price-card wide" : "price-card";
  const name = document.createElement("span");
  name.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = amount;
  card.append(name, strong);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    card.append(small);
  }
  return card;
}

function lotDetail() {
  if (!snapshot.shapes.lot || !current.parcel || current.lotOrigin === "manual") return "";
  const bits = [];
  if (current.parcel.situs) bits.push(current.parcel.situs);
  if (current.parcel.geoId) bits.push(`ID ${current.parcel.geoId}`);
  if (current.parcel.recordedSqft != null) {
    const acres = current.parcel.recordedAcres != null ? ` (${formatAcres(current.parcel.recordedAcres)})` : "";
    bits.push(`Recorded ${formatSqft(current.parcel.recordedSqft)}${acres}`);
  } else if (current.parcel.acreageLabel == null && current.lotOrigin === "collin") {
    bits.push("Recorded acreage did not load");
  }
  return bits.join(" · ");
}

function sourceLine() {
  const bits = ["Address: ArcGIS World Geocoding"];
  if (!snapshot.shapes.lot) bits.push("Lot: not drawn");
  else if (current.lotOrigin === "manual" || !current.lotOrigin) bits.push("Lot: drawn on the map");
  else {
    const edited = current.loadedLot && !sameGeometry(snapshot.shapes.lot, current.loadedLot);
    const name = current.parcel?.sourceLabel || "County GIS";
    bits.push(edited ? `Lot: ${name}, corners edited` : `Lot: ${name}`);
    if (current.parcel?.acreageLabel) bits.push(`Recorded size: ${current.parcel.acreageLabel}`);
  }
  if (!snapshot.shapes.house) bits.push("House: not drawn");
  else if (current.houseOrigin === "osm") {
    const edited = current.loadedHouse && !sameGeometry(snapshot.shapes.house, current.loadedHouse);
    bits.push(edited ? "House: OpenStreetMap, corners edited" : "House: OpenStreetMap");
  } else bits.push("House: drawn on the map");
  bits.push("Imagery: Esri World Imagery");
  return bits.join(" · ");
}

function renderHint() {
  const { draft, selected } = snapshot;
  const drawing = Boolean(draft);
  els.hint.hidden = !drawing && !selected;
  els.undo.hidden = !drawing;
  els.closeShape.hidden = !drawing;
  els.cancelDraw.hidden = !drawing;
  els.deleteVertex.hidden = !selected?.canDeleteVertex;
  els.redraw.hidden = !selected;
  els.deleteShape.hidden = !selected;
  if (drawing) {
    const name = KIND_LABEL[draft.kind] || "shape";
    els.hintText.textContent =
      draft.count < 3
        ? `Tap each corner of the ${name}. ${draft.count} point${draft.count === 1 ? "" : "s"} so far.`
        : `Tap the first corner, or Close shape, to finish the ${name}.`;
    els.closeShape.disabled = !draft.canClose;
    els.undo.disabled = draft.count === 0;
    return;
  }
  if (selected) {
    const name = KIND_LABEL[selected.kind] || "shape";
    els.hintText.textContent =
      selected.vertex != null
        ? `Corner ${selected.vertex + 1} of the ${name} is selected. Drag it, or delete it.`
        : `Drag the corners of the ${name}. Tap an edge to add a corner.`;
  }
}

function renderTools() {
  const tool = snapshot.draft?.kind || snapshot.selected?.kind || "pan";
  document.querySelectorAll("[data-tool]").forEach((button) => {
    const on = button.dataset.tool === tool;
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function render() {
  const measurement = measure(snapshot.shapes);
  const totals = sqftByKind(measurement);
  const hasLot = Boolean(snapshot.shapes.lot);
  const prices = hasLot ? quotePrices(measurement.mowableSqft, rates) : null;

  els.mowable.textContent = hasLot ? formatSqft(measurement.mowableSqft) : "Add a lot";
  els.areas.replaceChildren(
    areaRow("Lot", hasLot ? formatSqft(measurement.lotSqft) : "Not drawn", "lot", lotDetail()),
    areaRow(
      "House",
      snapshot.shapes.house || totals.roof ? formatSqft((totals.house || 0) + (totals.roof || 0)) : "Not drawn",
      "house",
      totals.roof ? "Includes other roofs on the lot." : "",
    ),
  );
  for (const kind of SUBTRACT_KINDS) {
    const drawn = snapshot.shapes.extras.some((extra) => extra.kind === kind);
    els.areas.append(
      areaRow(
        KIND_LABEL[kind][0].toUpperCase() + KIND_LABEL[kind].slice(1),
        drawn ? formatSqft(totals[kind] || 0) : "Not drawn",
        kind,
      ),
    );
  }

  const showAdjust = hasLot && measurement.adjusted;
  els.adjust.hidden = !showAdjust;
  els.adjust.textContent = showAdjust
    ? "Overlaps, and anything drawn outside the lot, are only subtracted once."
    : "";

  const roofs = current.otherBuildings.length;
  els.addRoofs.hidden = roofs === 0;
  els.addRoofs.textContent = `Add ${roofs} other roof${roofs === 1 ? "" : "s"} on this lot`;

  els.prices.replaceChildren();
  if (!prices) {
    els.tier.textContent = hasLot
      ? "Mowable turf is zero, so there is nothing to price yet."
      : `Weekly starts at ${formatMoney(rates.weeklyBase)} for the first ${formatSqft(rates.includedSqft)}.`;
  } else {
    els.prices.append(
      priceCard("Weekly", formatMoney(prices.weekly), "per visit", true),
      priceCard("Biweekly", formatMoney(prices.biweekly), "per visit"),
      priceCard("One-time cut", formatMoney(prices.oneTime), "one visit"),
      priceCard("Monthly, weekly", formatMoney(prices.monthlyWeekly), "about 4 visits"),
      priceCard("Monthly, biweekly", formatMoney(prices.monthlyBiweekly), "about 2 visits"),
    );
    const step =
      prices.tiers === 0
        ? `Inside the first ${formatSqft(rates.includedSqft)}.`
        : `${prices.tiers} size step${prices.tiers === 1 ? "" : "s"} past ${formatSqft(rates.includedSqft)}.`;
    const minimum = prices.weeklyMinimumApplied ? " Minimum charge applied." : "";
    els.tier.textContent = `${step}${minimum}`;
  }

  els.copy.disabled = !prices;
  els.save.disabled = !hasLot;
  els.sources.textContent = current.place ? sourceLine() : "Imagery: Esri World Imagery.";
  renderHint();
  renderTools();
}

async function onSubmit(event) {
  event.preventDefault();
  const text = els.address.value.trim();
  if (!text) return;
  setBusy(true);
  hideCandidates();
  try {
    setStatus("Looking up that address…");
    const candidates = await searchAddress(text);
    const best = candidates[0];
    if (!best || best.score < 85 || isWeakMatch(best)) {
      setStatus("No house match. Add the street number, city, and ZIP.", "error");
      return;
    }
    if (isAmbiguous(candidates)) {
      showCandidates(candidates);
      setStatus("A few addresses matched. Pick the right one.");
      return;
    }
    await loadProperty(best);
  } catch (error) {
    setStatus(
      error.message === "timed out"
        ? "The address search timed out. Try again."
        : "The address search didn't respond. Check your connection and try again.",
      "error",
    );
  } finally {
    setBusy(false);
  }
}

async function runLookup(place) {
  setBusy(true);
  try {
    await loadProperty(place);
  } catch {
    setStatus("That property didn't finish loading. Try the address again.", "error");
  } finally {
    setBusy(false);
  }
}

async function loadProperty(place) {
  const token = ++lookupToken;
  current = blankProperty();
  current.place = place;
  els.address.value = place.label;
  applying = true;
  map.clearShapes();
  map.setPin(place.lat, place.lng);
  applying = false;
  const rough =
    place.type && !["PointAddress", "Subaddress", "StreetAddress"].includes(place.type)
      ? " The match is the street, not a rooftop, so confirm the lot."
      : "";
  setStatus(`Found ${place.label}. Loading the lot from Collin and Denton county records…${rough}`);

  const { parcel, errors } = await lookupParcel(place.lng, place.lat);
  if (token !== lookupToken) return;
  current.parcel = parcel;
  if (parcel && !map.getShapes().lot) {
    current.lotOrigin = parcel.source;
    current.loadedLot = parcel.rings.map((ring) => stripClose(ring));
    applying = true;
    map.setLot(parcel.rings);
    map.fit();
    applying = false;
    current.loadedLot = map.getShapes().lot;
  }

  setStatus(
    parcel
      ? `Lot outline is on the map from ${parcel.sourceLabel}. Checking OpenStreetMap for the house…`
      : "No Collin or Denton parcel at this pin. Tap Lot and mark the corners. Checking OpenStreetMap for the house…",
  );

  const buildings = await lookupBuildings(place.lng, place.lat, map.getShapes().lot);
  if (token !== lookupToken) return;
  current.buildingServer = buildings.serverHost;
  current.buildingFailed = !buildings.serverHost;
  const choice = chooseHouse(buildings.buildings, place.lng, place.lat, map.getShapes().lot);
  current.otherBuildings = choice.others;
  if (choice.house && !map.getShapes().house) {
    current.houseOrigin = "osm";
    current.loadedHouse = [stripClose(choice.house.ring)];
    applying = true;
    map.setHouse(choice.house.ring);
    applying = false;
    current.loadedHouse = map.getShapes().house;
  }
  map.fit();

  const bits = [];
  if (parcel) {
    bits.push(`Lot from ${parcel.sourceLabel}.`);
    if (parcel.snapped) {
      bits.push("The pin missed the parcel, so this is the nearest lot. Redraw it if it is the neighbor.");
    }
  } else if (errors.length) {
    bits.push("County parcel layers didn't return a lot. Draw it by tapping the corners.");
  } else {
    bits.push("No public parcel at this pin. Tap Lot and mark the corners.");
  }
  if (map.getShapes().house && current.houseOrigin === "osm") {
    bits.push("House outline loaded from OpenStreetMap.");
  } else if (buildings.serverHost) {
    bits.push("No building footprint on this lot in OpenStreetMap. Tap House and trace the roof.");
  } else {
    bits.push("OpenStreetMap didn't respond. Tap House and trace the roof.");
  }
  if (rough) bits.push(rough.trim());
  setStatus(bits.join(" "));
  render();
}

function addOtherRoofs() {
  const extras = current.otherBuildings.map((building) => ({
    id: `roof-${building.id}`,
    kind: "roof",
    rings: [building.ring],
  }));
  if (!extras.length) return;
  applying = true;
  map.addExtras(extras);
  applying = false;
  current.otherBuildings = [];
  render();
}

function fillRatesForm() {
  for (const [key, value] of Object.entries(rates)) {
    const input = els.ratesForm.elements.namedItem(key);
    if (input) input.value = String(value);
  }
}

function readRatesForm() {
  const next = { ...rates };
  for (const key of Object.keys(DEFAULT_RATES)) {
    const input = els.ratesForm.elements.namedItem(key);
    const value = Number(input.value);
    if (input.value.trim() !== "" && Number.isFinite(value)) next[key] = value;
  }
  return normalizeRates(next);
}

async function copyQuote() {
  const measurement = measure(snapshot.shapes);
  const prices = quotePrices(measurement.mowableSqft, rates);
  if (!prices) return;
  const text = customerQuote({ address: current.place?.label || els.address.value.trim(), prices });
  els.quoteText.textContent = text;
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = false;
  }
  els.quoteTitle.textContent = copied ? "Quote copied" : "Quote";
  els.quoteNote.textContent = copied
    ? "It's on the clipboard, ready to paste into a text."
    : "Select the quote below and copy it from there.";
  els.quoteDialog.showModal();
}

function saveQuote() {
  const shapes = map.getShapes();
  if (!shapes.lot) return;
  const measurement = measure(shapes);
  const prices = quotePrices(measurement.mowableSqft, rates);
  const quote = {
    id: crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    address: current.place?.label || els.address.value.trim() || "Untitled lot",
    lat: current.place?.lat ?? null,
    lng: current.place?.lng ?? null,
    lot: shapes.lot,
    house: shapes.house,
    extras: shapes.extras,
    parcel: current.parcel
      ? {
          source: current.parcel.source,
          sourceLabel: current.parcel.sourceLabel,
          acreageLabel: current.parcel.acreageLabel,
          geoId: current.parcel.geoId,
          situs: current.parcel.situs,
          recordedSqft: current.parcel.recordedSqft,
          recordedAcres: current.parcel.recordedAcres,
        }
      : null,
    lotOrigin: current.lotOrigin,
    prices,
    mowableSqft: Math.round(measurement.mowableSqft),
  };
  const quotes = [quote, ...loadQuotes()].slice(0, 40);
  try {
    saveQuotes(quotes);
  } catch {
    setStatus("This phone couldn't store the quote. Free a little space and try again.", "error");
    return;
  }
  setStatus(`Saved the quote for ${quote.address} on this phone.`);
}

function openQuote(quote) {
  current = blankProperty();
  current.place =
    quote.lat != null && quote.lng != null
      ? { label: quote.address, lat: quote.lat, lng: quote.lng, type: "Saved", score: 100 }
      : { label: quote.address, lat: null, lng: null, type: "Saved", score: 100 };
  current.parcel = quote.parcel;
  current.lotOrigin = quote.lotOrigin || (quote.parcel ? quote.parcel.source : "manual");
  current.houseOrigin = quote.house ? "manual" : null;
  els.address.value = quote.address;
  applying = true;
  if (quote.lat != null && quote.lng != null) map.setPin(quote.lat, quote.lng);
  map.setShapes({ lot: quote.lot, house: quote.house, extras: quote.extras || [] });
  applying = false;
  current.loadedLot = quote.lotOrigin && quote.lotOrigin !== "manual" ? map.getShapes().lot : null;
  map.fit();
  els.savedDialog.close();
  setStatus(`Opened the saved quote for ${quote.address}. Prices use the current rate table.`);
  render();
}

function renderSaved() {
  const quotes = loadQuotes();
  els.savedEmpty.hidden = quotes.length > 0;
  els.savedList.replaceChildren();
  for (const quote of quotes) {
    const item = document.createElement("li");
    const text = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = quote.address;
    const meta = document.createElement("span");
    const when = new Date(quote.savedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const weekly = quote.prices ? formatMoney(quote.prices.weekly) : "no price";
    meta.textContent = `${when} · weekly ${weekly}`;
    text.append(title, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open";
    open.addEventListener("click", () => openQuote(quote));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => {
      if (!window.confirm("Delete this saved quote?")) return;
      saveQuotes(loadQuotes().filter((item) => item.id !== quote.id));
      renderSaved();
    });
    item.append(text, open, remove);
    els.savedList.append(item);
  }
}

els.search.addEventListener("submit", onSubmit);
els.addRoofs.addEventListener("click", addOtherRoofs);
document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => map.begin(button.dataset.tool));
});
els.undo.addEventListener("click", () => map.undo());
els.closeShape.addEventListener("click", () => map.closeDraft());
els.cancelDraw.addEventListener("click", () => map.cancelDraft());
els.deleteVertex.addEventListener("click", () => map.deleteSelectedVertex());
els.deleteShape.addEventListener("click", () => {
  if (window.confirm("Delete this shape?")) map.deleteSelected();
});
els.redraw.addEventListener("click", () => {
  if (window.confirm("Redraw this shape? The current corners will be cleared.")) map.redrawSelected();
});
document.querySelector("#edit-rates").addEventListener("click", () => {
  fillRatesForm();
  els.ratesDialog.showModal();
});
document.querySelector("#close-rates").addEventListener("click", () => els.ratesDialog.close());
document.querySelector("#reset-rates").addEventListener("click", () => {
  rates = saveRates({ ...DEFAULT_RATES });
  fillRatesForm();
  render();
});
els.ratesForm.addEventListener("input", () => {
  rates = saveRates(readRatesForm());
  render();
});
els.copy.addEventListener("click", copyQuote);
document.querySelector("#close-quote").addEventListener("click", () => els.quoteDialog.close());
els.save.addEventListener("click", saveQuote);
document.querySelector("#open-saved").addEventListener("click", () => {
  renderSaved();
  els.savedDialog.showModal();
});
document.querySelector("#close-saved").addEventListener("click", () => els.savedDialog.close());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && snapshot.draft) map.cancelDraft();
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}

render();
