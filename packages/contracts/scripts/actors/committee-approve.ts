// SCRIPTED ACTORS: committee members C3 and C4 approve a society proposal. If the AI flagged it, each
// approval carries a written override reason (note.v1), which the public dashboard shows. Say "scripted" on stage.
//
//   $env:PROPOSAL_ID="4"; pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/committee-approve.ts --network testnet
//
// PROPOSAL_ID  defaults to the newest Pending proposal
// MEMBERS      comma-separated aliases, default "C3,C4"
// REASON       optional override text (used for every member)
//
// Waits (up to 3 min) for the AI attestation first: a flag resets approvals, so approving earlier is wasted.
import hre from "hardhat";
import { actor, addressOf, link, postNote } from "./common";

const ZERO = "0x" + "0".repeat(64);
const PENDING = 0;

async function main() {
  const ledgerAddr = addressOf("SocietyLedger");
  const reader = await hre.ethers.getContractAt("SocietyLedger", ledgerAddr);

  let id = process.env.PROPOSAL_ID ? BigInt(process.env.PROPOSAL_ID) : 0n;
  if (!id) {
    for (let i = (await reader.nextProposalId()) - 1n; i >= 1n && !id; i--) {
      if (Number((await reader.getProposal(i)).status) === PENDING) id = i;
    }
    if (!id) throw new Error("No pending proposal");
  }

  let p = await reader.getProposal(id);
  for (let waited = 0; !p.attested && waited < 180; waited += 5) {
    if (waited === 0) console.log(`proposal ${id}: waiting for the AI attestation…`);
    await new Promise((r) => setTimeout(r, 5000));
    p = await reader.getProposal(id);
  }
  if (!p.attested) console.log(`proposal ${id}: still not attested after 3 min; approving anyway`);
  console.log(`proposal ${id}: amount ${hre.ethers.formatEther(p.amount)} tMSTC, flagged=${p.flagged}, risk ${p.riskScore}, approvals ${p.approvals}/${await reader.requiredApprovals(id)}`);

  for (const alias of (process.env.MEMBERS || "C3,C4").split(",").map((s) => s.trim())) {
    const member = actor(alias);
    p = await reader.getProposal(id);
    if (Number(p.status) !== PENDING) { console.log(`[scripted ${alias}] skipped: proposal is no longer pending`); break; }
    if (await reader.hasApproved(id, member.address)) { console.log(`[scripted ${alias}] already approved`); continue; }

    let reasonHash = ZERO;
    if (p.flagged) {
      const text = process.env.REASON ||
        `Scripted demo committee member (${alias}). I read the AI flag and the invoice, and I approve this payment with this written reason.`;
      reasonHash = await postNote(member, "override", text, [`proposal:${id}`]);
    }
    const tx = await reader.connect(member).approve(id, reasonHash);
    await tx.wait();
    console.log(`[scripted ${alias}] approved${p.flagged ? " with an override reason" : ""}  ${link(tx.hash)}`);
  }

  p = await reader.getProposal(id);
  console.log(`proposal ${id}: approvals ${p.approvals}/${await reader.requiredApprovals(id)}; canExecute: ${(await reader.canExecute(id)).join(" · ")}`);
  console.log("The keeper executes it within ~15 s once the rules are met.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
