import assert from "node:assert/strict";
import test from "node:test";
import { isAmbiguous } from "../src/geocode.js";
import { pointInRing } from "../src/geo.js";
import { pickParcel } from "../src/parcels.js";
import { customerQuote } from "../src/quoteText.js";

const LOT = [
  [-96.8024597283833, 33.236934309935776],
  [-96.80245838540195, 33.237112962345414],
  [-96.80294898053143, 33.23711556580571],
  [-96.80295032261446, 33.236936913401394],
];

test("customer quote is prices and the sign-off, without square footage", () => {
  const text = customerQuote({
    address: "109 W Fifth St, Prosper, Texas, 75078",
    prices: {
      weekly: 65,
      biweekly: 75,
      oneTime: 95,
      monthlyWeekly: 260,
      monthlyBiweekly: 150,
    },
  });
  assert.match(text, /Weekly mow: \$65 per visit/);
  assert.match(text, /Biweekly mow: \$75 per visit/);
  assert.match(text, /One-time cut: \$95/);
  assert.match(text, /Estimated monthly \(weekly\): \$260/);
  assert.match(text, /Estimated monthly \(biweekly\): \$150/);
  assert.match(text, /Erik, \+P Services, call or text \(214\) 995-3002/);
  assert.doesNotMatch(text, /sq ft/i);
  assert.match(text, /109 W Fifth St/);
});

test("a perfect rooftop match is not treated as ambiguous", () => {
  const candidates = [
    { score: 100, type: "PointAddress", label: "109 W Fifth St" },
    { score: 98.15, type: "PointAddress", label: "109 E Fifth St" },
  ];
  assert.equal(isAmbiguous(candidates), false);
  assert.equal(
    isAmbiguous([
      { score: 92, type: "StreetAddress", label: "A" },
      { score: 90.5, type: "StreetAddress", label: "B" },
    ]),
    true,
  );
});

test("the Fifth Street geocode sits inside the county parcel", () => {
  assert.equal(pointInRing(-96.802785097064, 33.236989864724, LOT), true);
  assert.equal(pointInRing(-96.8027, 33.2367, LOT), false);
});

test("parcel choice prefers the lot that contains the pin, then the smaller one", () => {
  const large = { snapped: false, snapMeters: 0, area: 50000, recordedSqft: 50000, source: "collin" };
  const small = { snapped: false, snapMeters: 0, area: 9000, recordedSqft: 9000, source: "denton" };
  const street = { snapped: true, snapMeters: 12, area: 8000, recordedSqft: 8000, source: "collin" };
  assert.equal(pickParcel([large, small, street]), small);
  assert.equal(pickParcel([street, null]), street);
  assert.equal(pickParcel([null, { ...street, snapMeters: 80 }]), null);
});
