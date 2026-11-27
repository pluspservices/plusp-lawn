export function formatSqft(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number).toLocaleString("en-US")} sq ft`;
}

export function formatAcres(acres) {
  const number = Number(acres);
  if (!Number.isFinite(number)) return "";
  const text = number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `${text} acres`;
}

export function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  const cents = Math.abs(number - Math.round(number)) > 0.001;
  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
