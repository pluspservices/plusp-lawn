import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRates, quotePrices, tiersFor } from "../src/pricing.js";

const rates = normalizeRates();

test("weekly tiers round a partial step up", () => {
  assert.equal(tiersFor(6000, rates), 0);
  assert.equal(tiersFor(6001, rates), 1);
  assert.equal(tiersFor(8500, rates), 1);
  assert.equal(tiersFor(8501, rates), 2);
  assert.equal(quotePrices(6000, rates).weekly, 55);
  assert.equal(quotePrices(6001, rates).weekly, 65);
  assert.equal(quotePrices(8501, rates).weekly, 75);
});

test("biweekly adds ten dollars and monthly counts the visits", () => {
  const prices = quotePrices(5000, rates);
  assert.equal(prices.weekly, 55);
  assert.equal(prices.biweekly, 65);
  assert.equal(prices.oneTime, 85);
  assert.equal(prices.monthlyWeekly, 220);
  assert.equal(prices.monthlyBiweekly, 130);
});

test("minimum charge lifts a low base", () => {
  const custom = normalizeRates({ weeklyBase: 40, oneTimeBase: 40, minimum: 70, biweeklySurcharge: 10 });
  const prices = quotePrices(1000, custom);
  assert.equal(prices.weekly, 70);
  assert.equal(prices.weeklyMinimumApplied, true);
  assert.equal(prices.biweekly, 80);
  assert.equal(prices.oneTime, 70);
});

test("no turf has no price, and saved rates fill gaps from the defaults", () => {
  assert.equal(quotePrices(0, rates), null);
  const merged = normalizeRates({ weeklyBase: 60 });
  assert.equal(merged.weeklyBase, 60);
  assert.equal(merged.includedSqft, 6000);
  assert.equal(merged.minimum, 55);
});
