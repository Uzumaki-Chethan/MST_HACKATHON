import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";
import { formatAmount, formatINR, formatMSTC, inrToWei, weiToInr } from "./money";
import { hashJson, isHex32 } from "./hash";

test("money: SPEC §4.5 examples at the default demo rate", () => {
  assert.equal(inrToWei(30_000), 30_000_000_000_000_000n); // 0.03 tMSTC
  assert.equal(weiToInr(180_000_000_000_000_000n), 180_000);
  assert.equal(formatMSTC(inrToWei(30_000)), "0.03 tMSTC");
  assert.equal(formatINR(180_000), "₹1,80,000");
  assert.equal(formatAmount(inrToWei(30_000)), "0.03 tMSTC (≈ ₹30,000 at demo rate)");
});

test("hashJson is key-order independent and matches keccak of canonical JSON", () => {
  const a = hashJson({ b: 1, a: "x" });
  assert.equal(a, hashJson({ a: "x", b: 1 }));
  assert.equal(a, keccak256(toBytes('{"a":"x","b":1}')));
  assert.ok(isHex32(a));
});
