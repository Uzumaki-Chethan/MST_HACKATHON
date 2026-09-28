// SPEC §11.2 seed step 1: every demo-cast wallet calls register (minting its passport); ADMIN verifies them.
// Real testnet transactions only. Safe to re-run: skips wallets already registered / verified.
// Run: pnpm exec hardhat run scripts/actors/register-cast.ts --network testnet
import hre from "hardhat";
import fs from "fs";
import path from "path";

const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments.json"), "utf8"));

// [alias, env key, kinds bitmask]  1 TENANT 2 LANDLORD 4 HOMEOWNER 8 CONTRACTOR 16 VENDOR 32 SUPPLIER 64 COMMITTEE 128 ARBITER
const CAST: [string, string, number][] = [
  ["MEERA", "MEERA_PRIVATE_KEY", 2 | 64],
  ["ROHAN", "ROHAN_PRIVATE_KEY", 2 | 4 | 64],
  ["ASHA", "ASHA_PRIVATE_KEY", 1],
  ["PRIYA", "PRIYA_PRIVATE_KEY", 2],
  ["C3", "C3_PRIVATE_KEY", 2 | 64],
  ["C4", "C4_PRIVATE_KEY", 2 | 64],
  ["C5", "C5_PRIVATE_KEY", 2 | 64],
  ["IMRAN", "IMRAN_PRIVATE_KEY", 8],
  ["ARB1", "ARB1_PRIVATE_KEY", 128],
  ["ARB2", "ARB2_PRIVATE_KEY", 128],
  ["ARB3", "ARB3_PRIVATE_KEY", 128],
  ["PLUMBER", "PLUMBER_PRIVATE_KEY", 16],
];

async function main() {
  const { ethers } = hre;
  const registryAddr = deployments[hre.network.name]?.NestRegistry?.address;
  if (!registryAddr) throw new Error(`No NestRegistry deployed on ${hre.network.name}`);
  const registry = await ethers.getContractAt("NestRegistry", registryAddr);

  for (const [alias, envKey, kinds] of CAST) {
    const wallet = new ethers.Wallet(process.env[envKey]!, ethers.provider);
    if (!(await registry.isRegistered(wallet.address))) {
      const tx = await registry.connect(wallet).register(kinds, ethers.ZeroHash);
      await tx.wait();
      console.log(`${alias.padEnd(6)} registered  https://testnet.mstscan.com/tx/${tx.hash}`);
    }
    if (!(await registry.isVerified(wallet.address))) {
      const tx = await registry.verify(wallet.address);
      await tx.wait();
      console.log(`${alias.padEnd(6)} verified    https://testnet.mstscan.com/tx/${tx.hash}`);
    }
  }
  console.log("Demo cast registered and verified.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
