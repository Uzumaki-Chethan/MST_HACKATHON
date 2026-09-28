// Live smoke test for the keeper (real testnet txs, small amounts): ROHAN offers ASHA a lease,
// ASHA signs and submits a move-in baseline, ROHAN stays silent. The backend keeper should then
// call finalizeBaseline after baselineWindow (90 s). Labelled "Scripted actor" wherever shown.
// Run: pnpm exec hardhat run scripts/actors/smoke-baseline.ts --network testnet
import hre from "hardhat";
import fs from "fs";
import path from "path";

const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments.json"), "utf8"));

async function main() {
  const { ethers } = hre;
  const rentalAddr = deployments[hre.network.name]?.RentalEscrow?.address;
  if (!rentalAddr) throw new Error(`No RentalEscrow on ${hre.network.name}`);
  const rohan = new ethers.Wallet(process.env.ROHAN_PRIVATE_KEY!, ethers.provider);
  const asha = new ethers.Wallet(process.env.ASHA_PRIVATE_KEY!, ethers.provider);
  const rental = await ethers.getContractAt("RentalEscrow", rentalAddr);
  const link = (h: string) => `https://testnet.mstscan.com/tx/${h}`;

  const id = await rental.nextId();
  const deposit = ethers.parseEther("0.01");
  let tx = await rental.connect(rohan).offerLease({
    tenant: asha.address, flatId: 0, rent: ethers.parseEther("0.001"), deposit, useTrustPricing: false,
    baseDepositMonths: 6, period: 90, periods: 2, grace: 30, baselineWindow: 90, claimWindow: 120,
    responseWindow: 90, termsHash: ethers.id("smoke-test-terms"),
  });
  await tx.wait();
  console.log(`lease ${id} offered   ${link(tx.hash)}`);
  tx = await rental.connect(asha).signLease(id, { value: deposit });
  await tx.wait();
  console.log(`lease ${id} signed    ${link(tx.hash)}`);
  tx = await rental.connect(asha).submitBaseline(id, ethers.id("smoke-baseline-bundle"), ethers.id("smoke-baseline-report"));
  await tx.wait();
  console.log(`baseline submitted ${link(tx.hash)}; the keeper should presume it after 90 s`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
