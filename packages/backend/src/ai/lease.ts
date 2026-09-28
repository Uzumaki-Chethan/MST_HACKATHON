// Reads the on-chain baseline a move-out comparison must use (RentalEscrow.getLease).
import { Contract } from "ethers";
import { addresses, BaselineStatus, rentalEscrowAbi, ZERO_HASH } from "@nestledger/shared";
import { BadStateError, type AiDeps } from "./common.js";

export type LeaseBaseline = {
  status: "Agreed" | "PresumedAccepted" | "Contested";
  baselineReportHash: string;
  counterEvidence: string | null;
};

export async function readLeaseBaseline(leaseId: string, deps: Pick<AiDeps, "chain">): Promise<LeaseBaseline> {
  const address = addresses[deps.chain.chainId]?.RentalEscrow;
  if (!address) throw new BadStateError("RentalEscrow is not deployed on this chain yet");
  const rental = new Contract(address, rentalEscrowAbi, deps.chain.provider);
  const lease = await rental.getLease(BigInt(leaseId));
  const status = BaselineStatus[Number(lease.baseline)];
  if (status !== "Agreed" && status !== "PresumedAccepted" && status !== "Contested") {
    throw new BadStateError(`The move-in baseline is "${status}". It must be agreed, presumed accepted or contested first.`);
  }
  const report = String(lease.baselineReport).toLowerCase();
  if (report === ZERO_HASH) throw new BadStateError("The baseline has no AI report hash to compare against");
  const counter = String(lease.counterEvidence).toLowerCase();
  return { status, baselineReportHash: report, counterEvidence: counter === ZERO_HASH ? null : counter };
}
