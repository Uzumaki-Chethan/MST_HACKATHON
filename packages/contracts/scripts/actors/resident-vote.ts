// SCRIPTED ACTORS: flat owners C3, C4, C5 (flats D-101, D-102, D-103) cast resident votes on a tier-2 proposal.
// The other owners (PRIYA A-101, ROHAN B-304, MEERA C-202) vote in the app with BridgeKey. Say "scripted" on stage.
//
//   $env:VOTE="against"; pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/resident-vote.ts --network testnet
//
// VOTE         "for" or "against" (default "against")
// PROPOSAL_ID  defaults to the newest proposal whose resident vote is open
// OWNERS       comma-separated aliases, default "C3,C4,C5"
import hre from "hardhat";
import { actor, addressOf, link } from "./common";

const COMMITTEE_APPROVED = 1;
const FLAT_OF: Record<string, bigint> = { PRIYA: 1n, ROHAN: 2n, MEERA: 3n, C3: 4n, C4: 5n, C5: 6n };

async function main() {
  const support = (process.env.VOTE || "against").toLowerCase() === "for";
  const ledger = await hre.ethers.getContractAt("SocietyLedger", addressOf("SocietyLedger"));

  let id = process.env.PROPOSAL_ID ? BigInt(process.env.PROPOSAL_ID) : 0n;
  if (!id) {
    for (let i = (await ledger.nextProposalId()) - 1n; i >= 1n && !id; i--) {
      if (Number((await ledger.getProposal(i)).status) === COMMITTEE_APPROVED) id = i;
    }
    if (!id) throw new Error("No proposal is in its resident vote (a bill above ₹50,000 needs committee approval first)");
  }

  for (const owner of (process.env.OWNERS || "C3,C4,C5").split(",").map((s) => s.trim())) {
    const flatId = FLAT_OF[owner];
    if (await ledger.hasVoted(id, flatId)) { console.log(`[scripted ${owner}] flat ${flatId} already voted`); continue; }
    const tx = await ledger.connect(actor(owner)).castVote(id, flatId, support);
    await tx.wait();
    console.log(`[scripted ${owner}] flat ${flatId} votes ${support ? "FOR" : "AGAINST"}  ${link(tx.hash)}`);
  }

  const p = await ledger.getProposal(id);
  const left = Number(p.voteEnds) - Number((await hre.ethers.provider.getBlock("latest"))!.timestamp);
  console.log(`proposal ${id}: for ${p.votesFor}, against ${p.votesAgainst}; vote closes in ${Math.max(0, left)} s, then the keeper pays or rejects it`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
