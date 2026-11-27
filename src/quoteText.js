import { formatMoney } from "./format.js";

/** Short customer text: the address, the prices, and Erik's sign-off. No measurements. */
export function customerQuote({ address, prices }) {
  return [
    "+P Services lawn quote",
    address || "Your property",
    "",
    `Weekly mow: ${formatMoney(prices.weekly)} per visit`,
    `Biweekly mow: ${formatMoney(prices.biweekly)} per visit`,
    `One-time cut: ${formatMoney(prices.oneTime)}`,
    `Estimated monthly (weekly): ${formatMoney(prices.monthlyWeekly)}`,
    `Estimated monthly (biweekly): ${formatMoney(prices.monthlyBiweekly)}`,
    "",
    "Erik, +P Services, call or text (214) 995-3002",
  ].join("\n");
}
