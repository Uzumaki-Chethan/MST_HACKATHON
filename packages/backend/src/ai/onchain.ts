// On-chain reads the milestone and invoice tasks need. One module so tests can mock it.
import { Contract } from "ethers";
import { addresses, milestoneEscrowAbi, societyLedgerAbi } from "@nestledger/shared";
import { BadStateError, type AiDeps } from "./common.js";

type Deps = Pick<AiDeps, "chain">;

function contract(deps: Deps, name: "MilestoneEscrow" | "SocietyLedger", abi: readonly unknown[]) {
  const address = addresses[deps.chain.chainId]?.[name];
  if (!address) throw new BadStateError(`${name} is not deployed on this chain yet`);
  return new Contract(address, abi as never, deps.chain.provider);
}

export type MilestoneOnChain = { specHash: string; itemCaps: bigint[]; round: number };

export async function readMilestone(projectId: string, milestoneIndex: number, deps: Deps): Promise<MilestoneOnChain> {
  const t = await contract(deps, "MilestoneEscrow", milestoneEscrowAbi).getTranche(BigInt(projectId), milestoneIndex);
  return {
    specHash: String(t.specHash).toLowerCase(),
    itemCaps: (t.itemCaps as bigint[]).map((x) => BigInt(x)),
    round: Number(t.round),
  };
}

/** The society's tier-1 limit (wei), used by anomaly rules R3 and R7. */
export async function readSocietyTier1(societyId: string, deps: Deps): Promise<bigint> {
  const s = await contract(deps, "SocietyLedger", societyLedgerAbi).getSociety(BigInt(societyId));
  return BigInt(s.config.tier1Limit);
}
