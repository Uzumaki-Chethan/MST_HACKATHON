// SocietyLedger structs as viem decodes them (Appendix A ISocietyLedger).
export type SocietyConfig = { threshold: number; tier1Limit: bigint; tier2Limit: bigint; quorumBps: number; votingPeriod: number; attestTimeout: number };
export type Society = {
  admin: `0x${string}`; name: string; metaHash: `0x${string}`; committee: readonly `0x${string}`[]; config: SocietyConfig;
  balance: bigint; committed: bigint; totalWeight: number; totalCollected: bigint; totalSpent: bigint;
};
export type Flat = {
  societyId: bigint; label: string; owner: `0x${string}`; tenant: `0x${string}`; delegate: `0x${string}`;
  weight: number; maintenance: bigint; totalPaid: bigint; lastPaidAt: bigint;
};
export type Proposal = {
  societyId: bigint; kind: number; status: number; proposer: `0x${string}`; payee: `0x${string}`; amount: bigint;
  docHash: `0x${string}`; category: string; tier: number; approvals: number; attested: boolean; flagged: boolean;
  riskScore: number; reportHash: `0x${string}`; createdAt: bigint; voteEnds: bigint; votesFor: bigint; votesAgainst: bigint;
  month: number; resultRef: bigint; data: `0x${string}`;
};

export const KIND_TEXT = ["Pay a vendor", "Fund a works project", "Decide on a works milestone", "Water tanker order (not supported)"] as const; // index = on-chain ProposalKind; TankerOrder reverts

export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
export const sameAddr = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A flat's vote is cast by its delegate if one is set, otherwise by its owner (SPEC §2.3). */
export const votesFor = (f: Flat, who?: string) => (f.delegate === ZERO_ADDR ? sameAddr(f.owner, who) : sameAddr(f.delegate, who));

/** "Paid this month" for the public per-flat status. */
export function paidThisMonth(f: Flat, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (f.lastPaidAt === BigInt(0)) return false;
  const d = new Date(Number(f.lastPaidAt) * 1000), n = new Date(nowSec * 1000);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}
