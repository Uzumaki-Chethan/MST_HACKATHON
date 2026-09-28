import { test } from "node:test";
import assert from "node:assert/strict";
import { hashJson } from "../hash";
import { manifestSchemas, parseManifest, RentalClaimSchema, ProfileMetaSchema } from "./index";

const H = "0x" + "ab".repeat(32);
const now = new Date().toISOString();

test("parseManifest accepts a valid bundle and the hash is stable", () => {
  const bundle = {
    schema: "nestledger.bundle.v1",
    context: { type: "lease", id: "1", stage: "move-in" },
    createdBy: "0x" + "11".repeat(20),
    createdAt: now,
    items: [{ hash: H, kind: "photo", mime: "image/jpeg", room: "living", vantageId: "living-wide", captureMode: "live" }],
  };
  const { schema, value } = parseManifest(bundle);
  assert.equal(schema, "nestledger.bundle.v1");
  assert.equal(hashJson(value), hashJson(bundle));
});

test("parseManifest rejects unknown schemas and bad shapes", () => {
  assert.throws(() => parseManifest({ schema: "nope" }), /unknown manifest schema/);
  assert.throws(() => parseManifest({ schema: "nestledger.note.v1", createdAt: now, purpose: "override" }));
});

test("rental claim: item 0 must be unpaid_dues and indexes must match", () => {
  const base = { schema: "nestledger.claim.rental.v1", createdAt: now, leaseId: "1", moveOutReportHash: H };
  const item0 = { index: 0, type: "unpaid_dues", description: "rent", amountWei: "0", amountINR: 0 };
  const tile = { index: 1, type: "damage", findingId: "f1", description: "tile", amountWei: "450000000000000", amountINR: 450 };
  assert.ok(RentalClaimSchema.safeParse({ ...base, items: [item0, tile] }).success);
  assert.ok(!RentalClaimSchema.safeParse({ ...base, items: [tile] }).success);
  assert.ok(!RentalClaimSchema.safeParse({ ...base, items: [item0, { ...tile, index: 5 }] }).success);
});

test("profile meta rejects extra personal fields", () => {
  const p = { schema: "nestledger.profile.v1", createdAt: now, kinds: ["TENANT"] };
  assert.ok(ProfileMetaSchema.safeParse(p).success);
  assert.ok(!ProfileMetaSchema.safeParse({ ...p, phone: "9999999999" }).success);
});

test("every registered schema key matches its literal", () => {
  for (const [key, s] of Object.entries(manifestSchemas)) {
    const shape = (s as any)._def.schema?._def?.schema?.shape ?? (s as any)._def.schema?.shape ?? (s as any).shape;
    assert.equal(shape.schema.value, key);
  }
});
