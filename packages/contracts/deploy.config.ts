import type { HardhatRuntimeEnvironment } from "hardhat/types";

type Deployed = Record<string, { address: string; constructorArguments: unknown[] }>;

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * SPEC §5.10 deploy + wiring, all in one run: registry, passport, resolver, ledger, rental and
 * milestone escrows, roles, modules, arbiters, tier params. TankerTrust is out of scope for this
 * build (SPEC-CHANGES 2026-09-29), so the ledger's tanker module is the zero address.
 *
 * On a local chain (hardhat / localhost) the attestor and arbiters default to hardhat test
 * accounts #1–#4 when ATTESTOR_ADDRESS / ARBITER_1..3 are not set.
 */
export async function deployAll(hre: HardhatRuntimeEnvironment): Promise<Deployed> {
  const { ethers } = hre;
  const signers = await ethers.getSigners();
  const admin = signers[0];
  const local = hre.network.name === "hardhat" || hre.network.name === "localhost";
  const addr = (key: string, fallback?: number) => {
    const v = process.env[key];
    if (v && ethers.isAddress(v)) return v;
    if (local && fallback !== undefined && signers[fallback]) return signers[fallback].address;
    throw new Error(`${key} missing from .env.local`);
  };
  const attestor = addr("ATTESTOR_ADDRESS", 1);
  const arbiters = [addr("ARBITER_1", 2), addr("ARBITER_2", 3), addr("ARBITER_3", 4)];
  const demo = process.env.DEMO === "1" || local;
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
  const ledger = await deploy("SocietyLedger", [out.NestRegistry.address, out.NestPassport.address]);
  await deploy("RentalEscrow", [out.NestRegistry.address, out.NestPassport.address, out.DisputeResolver.address, out.SocietyLedger.address]);
  await deploy("MilestoneEscrow", [out.NestRegistry.address, out.NestPassport.address, out.DisputeResolver.address]);

  const MODULE = await registry.MODULE_ROLE();
  for (const name of ["DisputeResolver", "SocietyLedger", "RentalEscrow", "MilestoneEscrow"]) {
    await send(`MODULE_ROLE → ${name}`, registry.grantRole(MODULE, out[name].address));
  }
  await send("ledger.setModules(rental, milestone, no tanker)",
    ledger.setModules(out.RentalEscrow.address, out.MilestoneEscrow.address, ZERO));
  await send("ATTESTOR_ROLE → attestor", registry.grantRole(await registry.ATTESTOR_ROLE(), attestor));
  await send("VERIFIER_ROLE → admin", registry.grantRole(await registry.VERIFIER_ROLE(), admin.address));
  for (let i = 0; i < 3; i++) await send(`resolver.addArbiter(ARBITER_${i + 1})`, resolver.addArbiter(arbiters[i]));
  await send(`passport.setTierParams(${demo ? 2 : 6})`, passport.setTierParams(demo ? 2 : 6));

  return out;
}
