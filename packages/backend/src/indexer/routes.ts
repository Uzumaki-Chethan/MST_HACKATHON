// SPEC §7.3 routes served from the indexer: /timeline, /me/flats, /me/feed.
import type { FastifyInstance } from "fastify";
import type { Db } from "../db/index.js";
import { requireUser } from "../auth/index.js";
import { badRequest } from "../errors.js";

const TIMELINE_CONTRACT: Record<string, string> = {
  rental: "RentalEscrow",
  milestone: "MilestoneEscrow",
  ledger: "SocietyLedger",
  tanker: "TankerTrust",
  dispute: "DisputeResolver",
};

type EventRow = { contract: string; name: string; block: number; tx_hash: string; log_index: number; ts: number; args_json: string };

export const toTimelineItem = (r: EventRow) => ({
  contract: r.contract, name: r.name, args: JSON.parse(r.args_json),
  txHash: r.tx_hash, blockNumber: r.block, timestamp: r.ts,
});

export function registerIndexerRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Params: { contract: string; id: string } }>("/timeline/:contract/:id", async (req) => {
    const contract = TIMELINE_CONTRACT[req.params.contract];
    if (!contract) throw badRequest(`contract must be one of ${Object.keys(TIMELINE_CONTRACT).join(", ")}`);
    if (!/^\d+$/.test(req.params.id)) throw badRequest("id must be a number");
    const rows = db.query<EventRow>(
      "SELECT * FROM events WHERE contract = ? AND k1 = ? ORDER BY block, log_index", [contract, req.params.id]);
    return rows.map(toTimelineItem);
  });

  app.get("/me/flats", async (req) => {
    const user = requireUser(req);
    const rows = db.query<{ args_json: string }>(
      "SELECT args_json FROM events WHERE contract = 'SocietyLedger' AND name = 'FlatAdded' ORDER BY block, log_index");
    return rows
      .map((r) => JSON.parse(r.args_json))
      .filter((a) => a.owner === user)
      .map((a) => ({ flatId: a.flatId, societyId: a.societyId, label: a.label, maintenanceWei: a.maintenance }));
  });

  // P1 notification feed: the latest events that mention the caller's address anywhere in their args.
  app.get("/me/feed", async (req) => {
    const user = requireUser(req);
    const rows = db.query<EventRow>(
      "SELECT * FROM events WHERE args_json LIKE ? ORDER BY block DESC, log_index DESC LIMIT 50", [`%"${user}"%`]);
    return rows.map(toTimelineItem);
  });
}
