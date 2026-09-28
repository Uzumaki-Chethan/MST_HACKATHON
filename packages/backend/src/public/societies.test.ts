import { describe, expect, it } from "vitest";
import { openDb } from "../db/index.js";
import { currentApprovers } from "./societies.js";

const ZERO = "0x" + "0".repeat(64);
const MEERA = "0xff5b2001176224d3ae7a6cd87878a2a2285e8ffe";
const C3 = "0x2b0b8897ca420e62b83c113d6e6a5d7bcef14698";
let logIndex = 0;

function addEvent(db: ReturnType<typeof openDb>, name: string, args: Record<string, string>) {
  db.run(
    "INSERT INTO events (contract, name, block, tx_hash, log_index, ts, args_json, k1, k2) VALUES ('SocietyLedger', ?, 1, '0x1', ?, 0, ?, ?, NULL)",
    [name, ++logIndex, JSON.stringify(args), args.proposalId],
  );
}

describe("currentApprovers", () => {
  it("drops approvals that a flagged attestation reset, and reads override notes", () => {
    const db = openDb(":memory:");
    const note = "0x" + "a".repeat(64);
    db.run("INSERT INTO manifests (hash, schema, json, uploader, is_public, created_at) VALUES (?, 'nestledger.note.v1', ?, ?, 1, 0)",
      [note, JSON.stringify({ text: "burst pipe" }), MEERA]);
    addEvent(db, "Approved", { proposalId: "4", member: MEERA, overrideReasonHash: ZERO }); // auto-approval at propose
    addEvent(db, "InvoiceAttested", { proposalId: "4", reportHash: ZERO, riskScore: "80", flagged: "true" });
    addEvent(db, "Approved", { proposalId: "4", member: MEERA, overrideReasonHash: note });
    addEvent(db, "Approved", { proposalId: "4", member: C3, overrideReasonHash: note });
    addEvent(db, "Approved", { proposalId: "5", member: C3, overrideReasonHash: ZERO });

    expect(currentApprovers(db, "4")).toEqual([
      { member: MEERA, overrideReasonHash: note, overrideText: "burst pipe" },
      { member: C3, overrideReasonHash: note, overrideText: "burst pipe" },
    ]);
  });

  it("keeps every approval when the attestation was clean", () => {
    const db = openDb(":memory:");
    addEvent(db, "Approved", { proposalId: "1", member: MEERA, overrideReasonHash: ZERO });
    addEvent(db, "InvoiceAttested", { proposalId: "1", reportHash: ZERO, riskScore: "0", flagged: "false" });
    expect(currentApprovers(db, "1")).toEqual([{ member: MEERA, overrideReasonHash: null, overrideText: null }]);
  });
});
