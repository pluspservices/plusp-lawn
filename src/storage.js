import { normalizeRates } from "./pricing.js";

const RATES_KEY = "plusp.rates.v1";
const QUOTES_KEY = "plusp.quotes.v1";

export function loadRates() {
  try {
    return normalizeRates(JSON.parse(localStorage.getItem(RATES_KEY) || "null"));
  } catch {
    return normalizeRates();
  }
}

export function saveRates(rates) {
  const normalized = normalizeRates(rates);
  localStorage.setItem(RATES_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadQuotes() {
  try {
    const quotes = JSON.parse(localStorage.getItem(QUOTES_KEY) || "[]");
    return Array.isArray(quotes) ? quotes : [];
  } catch {
    return [];
  }
}

export function saveQuotes(quotes) {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes));
  return quotes;
}
