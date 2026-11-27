/** The only default rate table. Edits the user saves live in localStorage. */
export const DEFAULT_RATES = Object.freeze({
  weeklyBase: 55,
  includedSqft: 6000,
  tierSqft: 2500,
  tierPrice: 10,
  biweeklySurcharge: 10,
  oneTimeBase: 85,
  minimum: 55,
});

const RATE_KEYS = Object.keys(DEFAULT_RATES);

export function normalizeRates(raw) {
  const rates = { ...DEFAULT_RATES };
  for (const key of RATE_KEYS) {
    const value = Number(raw?.[key]);
    if (Number.isFinite(value)) rates[key] = value;
  }
  if (rates.tierSqft <= 0) rates.tierSqft = DEFAULT_RATES.tierSqft;
  if (rates.includedSqft < 0) rates.includedSqft = 0;
  return rates;
}

export function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Whole steps past the included turf. A partial step rounds up. */
export function tiersFor(sqft, rates) {
  const extra = Math.max(0, sqft - rates.includedSqft);
  if (extra <= 0) return 0;
  return Math.ceil((extra - 1e-6) / rates.tierSqft);
}

export function visitPrice(sqft, base, rates) {
  const raw = base + tiersFor(sqft, rates) * rates.tierPrice;
  return {
    price: roundMoney(Math.max(rates.minimum, raw)),
    minimumApplied: raw < rates.minimum - 0.001,
  };
}

export function quotePrices(sqft, rawRates) {
  const rates = normalizeRates(rawRates);
  const rounded = Math.round(Number(sqft));
  if (!(rounded > 0)) return null;
  const weekly = visitPrice(rounded, rates.weeklyBase, rates);
  const oneTime = visitPrice(rounded, rates.oneTimeBase, rates);
  const biweekly = roundMoney(Math.max(rates.minimum, weekly.price + rates.biweeklySurcharge));
  return {
    sqft: rounded,
    tiers: tiersFor(rounded, rates),
    weekly: weekly.price,
    weeklyMinimumApplied: weekly.minimumApplied,
    biweekly,
    oneTime: oneTime.price,
    oneTimeMinimumApplied: oneTime.minimumApplied,
    monthlyWeekly: roundMoney(weekly.price * 4),
    monthlyBiweekly: roundMoney(biweekly * 2),
  };
}
