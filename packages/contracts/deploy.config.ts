import type { HardhatRuntimeEnvironment } from "hardhat/types";

type Deployed = Record<string, { address: string; constructorArguments: unknown[] }>;

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * SPEC §5.10 deploy + wiring. Built up module by module: A1 registry/passport/rental, A2 resolver +
 * milestone escrow. SocietyLedger and TankerTrust arrive with A3; until then RentalEscrow gets the
 * zero address as its ledger (leases must use flatId 0).
 */
export async function deployAll(hre: HardhatRuntimeEnvironment): Promise<Deployed> {
  const { ethers } = hre;
  const [admin] = await ethers.getSigners();
  const attestor = process.env.ATTESTOR_ADDRESS;
  if (!attestor || !ethers.isAddress(attestor)) throw new Error("ATTESTOR_ADDRESS missing from .env.local");
  const demo = process.env.DEMO === "1";
  const out: Deployed = {};

  async function deploy(name: string, args: unknown[]) {
    const factory = await ethers.getContractFactory(name);
    const c = await factory.deploy(...args);
    await c.waitForDeployment();
    const address = await c.getAddress();
    out[name] = { address, constructorArguments: args };
    console.log(`  ${name.padEnd(16)} ${address}`);
    return c as any;
  }
  async function send(label: string, txp: Promise<any>) {
    const tx = await txp;
    await tx.wait();
    console.log(`  ✓ ${label}`);
  }

  const registry = await deploy("NestRegistry", [admin.address]);
  const passport = await deploy("NestPassport", [out.NestRegistry.address]);
  await send("registry.setPassport", registry.setPassport(out.NestPassport.address));
  const bond = ethers.parseEther(process.env.DISPUTE_BOND ?? "0.001");
  const votingWindow = demo ? 300 : 5 * 24 * 3600;
  const resolver = await deploy("DisputeResolver", [out.NestRegistry.address, out.NestPassport.address, bond, votingWindow]);
  const ledgerAddr = out.SocietyLedger?.address ?? ZERO;
  await deploy("RentalEscrow", [out.NestRegistry.address, out.NestPassport.address, out.DisputeResolver.address, ledgerAddr]);
  await deploy("MilestoneEscrow", [out.NestRegistry.address, out.NestPassport.address, out.DisputeResolver.address]);

  const MODULE = await registry.MODULE_ROLE();
  for (const name of ["DisputeResolver", "RentalEscrow", "MilestoneEscrow"]) {
    await send(`MODULE_ROLE → ${name}`, registry.grantRole(MODULE, out[name].address));
  }
  await send("ATTESTOR_ROLE → attestor", registry.grantRole(await registry.ATTESTOR_ROLE(), attestor));
  await send("VERIFIER_ROLE → admin", registry.grantRole(await registry.VERIFIER_ROLE(), admin.address));
  for (const key of ["ARBITER_1", "ARBITER_2", "ARBITER_3"]) {
    const a = process.env[key];
    if (!a || !ethers.isAddress(a)) throw new Error(`${key} missing from .env.local`);
    await send(`resolver.addArbiter(${key})`, resolver.addArbiter(a));
  }
  await send(`passport.setTierParams(${demo ? 2 : 6})`, passport.setTierParams(demo ? 2 : 6));

  return out;
}
