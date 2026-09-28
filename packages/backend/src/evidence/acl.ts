// SPEC §7.6. Who may read files, manifests and reports, by context.
// lease:{id} and project:{id} are checked against on-chain views (cached 30 s);
// proposal / society / order are public on purpose (transparency).
import { Contract } from "ethers";
import {
  disputeResolverAbi, milestoneEscrowAbi, rentalEscrowAbi, societyLedgerAbi,
} from "@nestledger/shared";
import type { ChainClients } from "../chain/index.js";
import { addressOf } from "../chain/index.js";

export type ContextRef = { type: string | null; id: string | null; uploader: string | null; isPublic: boolean };

const PUBLIC_CONTEXTS = new Set(["proposal", "society", "order"]);
const CACHE_MS = 30_000;
const cache = new Map<string, { readers: Set<string>; at: number }>();

export function contextIsPublic(type: string | null | undefined): boolean {
  return !!type && PUBLIC_CONTEXTS.has(type);
}

/** true when `user` (lowercase address or null) may read something stored under `ctx`. */
export async function canRead(chain: ChainClients, ctx: ContextRef, user: string | null): Promise<boolean> {
  if (ctx.isPublic || contextIsPublic(ctx.type)) return true;
  if (!user) return false;
  if (ctx.uploader === user) return true;
  if (!ctx.type || !ctx.id) return true; // no context (e.g. lease terms before the offer): any signed-in user
  const readers = await readersOf(chain, ctx.type, ctx.id);
  return readers.has(user);
}

async function readersOf(chain: ChainClients, type: string, id: string): Promise<Set<string>> {
  const key = `${type}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.readers;

  const readers = new Set<string>();
  const add = (a: string) => readers.add(a.toLowerCase());
  try {
    if (type === "lease") {
      const rental = addressOf(chain.chainId, "RentalEscrow");
      if (rental) {
        const c = new Contract(rental, rentalEscrowAbi, chain.provider);
        const lease = await c.getLease(id);
        add(lease.tenant); add(lease.landlord);
        await addArbiters(chain, rental, id, add);
      }
    } else if (type === "project") {
      const milestone = addressOf(chain.chainId, "MilestoneEscrow");
      if (milestone) {
        const c = new Contract(milestone, milestoneEscrowAbi, chain.provider);
        const ag = await c.getAgreement(id);
        add(ag.payer); add(ag.payee);
        if (ag.payerRef !== 0n) await addSocietyMembers(chain, ag.payerRef, add);
        const current = Number(ag.current);
        for (let idx = 0; idx <= current; idx++) await addArbiters(chain, milestone, id, add, idx);
      }
    }
  } catch (err) {
    console.warn(`[acl] could not read ${key} from chain:`, (err as Error).message);
  }
  cache.set(key, { readers, at: Date.now() });
  return readers;
}

async function addArbiters(chain: ChainClients, escrow: string, id: string, add: (a: string) => void, idx = 0) {
  const resolver = addressOf(chain.chainId, "DisputeResolver");
  if (!resolver) return;
  const r = new Contract(resolver, disputeResolverAbi, chain.provider);
  const disputeId = await r.disputeFor(escrow, id, idx);
  if (disputeId === 0n) return;
  const d = await r.getDispute(disputeId);
  for (const a of d.arbiters) add(a);
}

async function addSocietyMembers(chain: ChainClients, societyId: bigint, add: (a: string) => void) {
  const ledger = addressOf(chain.chainId, "SocietyLedger");
  if (!ledger) return;
  const l = new Contract(ledger, societyLedgerAbi, chain.provider);
  const s = await l.getSociety(societyId);
  for (const m of s.committee) add(m);
  for (const flatId of await l.flatsOf(societyId)) add((await l.getFlat(flatId)).owner);
}
