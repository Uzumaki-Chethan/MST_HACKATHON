// Tops up every SPEC §11.1 demo-cast wallet from ADMIN (PRIVATE_KEY) to the amount it needs.
// Dry run (just show balances): DRY=1 pnpm exec hardhat run scripts/fund-cast.ts --network testnet
// Send:                                 pnpm exec hardhat run scripts/fund-cast.ts --network testnet
import hre from "hardhat";

const NEEDS: [string, string, string][] = [
  ["AGENT", "ATTESTOR_PRIVATE_KEY", "0.2"],
  ["KEEPER", "KEEPER_PRIVATE_KEY", "0.5"],
  ["MEERA", "MEERA_PRIVATE_KEY", "0.2"],
  ["ROHAN", "ROHAN_PRIVATE_KEY", "0.8"],
  ["ASHA", "ASHA_PRIVATE_KEY", "0.4"],
  ["PRIYA", "PRIYA_PRIVATE_KEY", "0.05"],
  ["C3", "C3_PRIVATE_KEY", "0.05"],
  ["C4", "C4_PRIVATE_KEY", "0.05"],
  ["C5", "C5_PRIVATE_KEY", "0.05"],
  ["IMRAN", "IMRAN_PRIVATE_KEY", "0.05"],
  ["ARB1", "ARB1_PRIVATE_KEY", "0.05"],
  ["ARB2", "ARB2_PRIVATE_KEY", "0.05"],
  ["ARB3", "ARB3_PRIVATE_KEY", "0.05"],
];
const ADMIN_KEEPS = "0.3";

async function main() {
  const { ethers } = hre;
  const [admin] = await ethers.getSigners();
  const fmt = (v: bigint) => ethers.formatEther(v).padStart(10);
  const dry = !!process.env.DRY;

  let shortfall = 0n;
  const plan: { alias: string; to: string; amount: bigint; has: bigint }[] = [];
  for (const [alias, envKey, need] of NEEDS) {
    const key = process.env[envKey];
    if (!key) throw new Error(`${envKey} missing from .env.local; run scripts/make-wallets.ts`);
    const to = new ethers.Wallet(key).address;
    const has = await ethers.provider.getBalance(to);
    const want = ethers.parseEther(need);
    const amount = has >= want ? 0n : want - has;
    shortfall += amount;
    plan.push({ alias, to, amount, has });
  }
  const adminBal = await ethers.provider.getBalance(admin.address);
  console.log(`ADMIN ${admin.address} balance ${ethers.formatEther(adminBal)} tMSTC\n`);
  console.log("Alias      Address                                       has        send");
  for (const p of plan) console.log(`${p.alias.padEnd(10)} ${p.to}  ${fmt(p.has)}  ${fmt(p.amount)}`);

  const needed = shortfall + ethers.parseEther(ADMIN_KEEPS);
  console.log(`\nADMIN needs ${ethers.formatEther(needed)} tMSTC in total (${ADMIN_KEEPS} kept for deploys).`);
  if (dry) return;
  if (adminBal < shortfall) {
    console.log(`Not enough: claim more from the faucet into ADMIN (short by ${ethers.formatEther(shortfall - adminBal)}).`);
    return;
  }
  for (const p of plan) {
    if (p.amount === 0n) continue;
    const tx = await admin.sendTransaction({ to: p.to, value: p.amount });
    await tx.wait();
    console.log(`sent ${ethers.formatEther(p.amount)} to ${p.alias}: https://testnet.mstscan.com/tx/${tx.hash}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
