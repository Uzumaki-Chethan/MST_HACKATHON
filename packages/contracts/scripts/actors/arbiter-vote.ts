// SCRIPTED ACTOR: arbiter ARB2 (or ARB3) votes on a dispute, with a written rationale (note.v1).
// Used in the demo's itemised-dispute beat after ARB1 votes live in BridgeKey. Say "scripted" on stage.
//
//   $env:DISPUTE_ID="1"; $env:UPHOLD_MASK="0"; pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/arbiter-vote.ts --network testnet
//
// DISPUTE_ID   the dispute to vote on; defaults to the newest open dispute where this arbiter hasn't voted
// UPHOLD_MASK  bit i set = uphold claim item i (only disputed items may be set); default 0 = reject all
// ARBITER      ARB2 (default) or ARB3
// REASON       optional rationale text
import hre from "hardhat";
import { actor, addressOf, link, postNote } from "./common";

async function main() {
  const alias = process.env.ARBITER || "ARB2";
  const arb = actor(alias);
  const resolver = await hre.ethers.getContractAt("DisputeResolver", addressOf("DisputeResolver"), arb);

  let id = process.env.DISPUTE_ID ? BigInt(process.env.DISPUTE_ID) : 0n;
  if (!id) {
    for (let i = (await resolver.nextDisputeId()) - 1n; i >= 1n && !id; i--) {
      const d = await resolver.getDispute(i);
      const slot = d.arbiters.findIndex((a: string) => a.toLowerCase() === arb.address.toLowerCase());
      if (Number(d.status) === 0 && slot >= 0 && (Number(d.votedBits) & (1 << slot)) === 0) id = i;
    }
    if (!id) throw new Error(`No open dispute is waiting for ${alias}'s vote`);
  }

  const d = await resolver.getDispute(id);
  const mask = Number(process.env.UPHOLD_MASK || "0");
  const items = [...Array(d.amounts.length).keys()].filter((i) => (Number(d.mask) >> i) & 1);
  const decision = items.map((i) => `item ${i} ${(mask >> i) & 1 ? "upheld" : "rejected"}`).join(", ");
  const text = process.env.REASON ||
    `Scripted demo arbiter (${alias}). Reviewed the claim evidence and the AI report: ${decision}.`;

  const rationaleHash = await postNote(arb, "rationale", text, [`dispute:${id}`]);
  const tx = await resolver.vote(id, mask, rationaleHash);
  await tx.wait();
  const after = await resolver.getDispute(id);
  console.log(`[scripted ${alias}] voted on dispute ${id}: ${decision}`);
  console.log(`  vote tx ${link(tx.hash)}`);
  console.log(`  dispute is now ${Number(after.status) === 0 ? "still open (waiting for another vote)" : "RESOLVED and paid out in this tx"}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
