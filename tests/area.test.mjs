import assert from "node:assert/strict";
import test from "node:test";
import { SQFT_PER_SQM, measure, ringGeodesicM2, ringGeodesicSqft } from "../src/area.js";
import { quotePrices } from "../src/pricing.js";

const PROSPER_LOT = [
  [-96.8024597283833, 33.236934309935776],
  [-96.80245838540195, 33.237112962345414],
  [-96.80294898053143, 33.23711556580571],
  [-96.80295032261446, 33.236936913401394],
];

const PROSPER_HOUSE = [
  [-96.802537, 33.236945],
  [-96.802885, 33.236948],
  [-96.802885, 33.237024],
  [-96.802681, 33.237022],
  [-96.802681, 33.237034],
  [-96.802536, 33.237032],
];

test("one-degree square matches GeographicLib", () => {
  const squareMeters = ringGeodesicM2([
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
  assert.ok(Math.abs(squareMeters - 12308778361.469452) < 0.01);
  assert.equal(ringGeodesicSqft([[0, 0], [1, 0], [1, 1], [0, 1]]), squareMeters * SQFT_PER_SQM);
});

test("109 W Fifth St lot matches the geodesic reference and county acreage", () => {
  const sqft = ringGeodesicSqft(PROSPER_LOT);
  assert.ok(Math.abs(sqft - 9752.41950553221) < 0.05);
  const recorded = 9748.72;
  assert.ok(Math.abs(sqft - recorded) / recorded < 0.001);
});

test("house footprint and mowable turf for the Prosper lot", () => {
  const house = ringGeodesicSqft(PROSPER_HOUSE);
  assert.ok(Math.abs(house - 3127.3031648553297) < 0.05);
  const result = measure({
    lot: [PROSPER_LOT],
    house: [PROSPER_HOUSE],
    extras: [],
  });
  assert.ok(result.mowableSqft < result.lotSqft);
  assert.ok(Math.abs(result.lotSqft - result.mowableSqft - house) < 30);
  const prices = quotePrices(result.mowableSqft, {});
  assert.equal(prices.tiers, 1);
  assert.equal(prices.weekly, 65);
  assert.equal(prices.biweekly, 75);
  assert.equal(prices.oneTime, 95);
  assert.equal(prices.monthlyWeekly, 260);
  assert.equal(prices.monthlyBiweekly, 150);
});

test("overlapping and outside shapes are subtracted once, inside the lot", () => {
  const lot = [
    [0, 0],
    [0.002, 0],
    [0.002, 0.002],
    [0, 0.002],
  ];
  const house = [
    [0.0004, 0.0004],
    [0.001, 0.0004],
    [0.001, 0.001],
    [0.0004, 0.001],
  ];
  const outside = [
    [0.01, 0.01],
    [0.012, 0.01],
    [0.012, 0.012],
    [0.01, 0.012],
  ];
  const once = measure({ lot: [lot], house: [house], extras: [] });
  const doubled = measure({
    lot: [lot],
    house: [house],
    extras: [{ id: "copy", kind: "roof", rings: [house] }],
  });
  const spilled = measure({
    lot: [lot],
    house: [house],
    extras: [{ id: "drive", kind: "driveway", rings: [outside] }],
  });
  assert.ok(Math.abs(doubled.mowableSqft - once.mowableSqft) < 5);
  assert.ok(Math.abs(spilled.mowableSqft - once.mowableSqft) < 5);
  assert.equal(spilled.adjusted, true);
});
