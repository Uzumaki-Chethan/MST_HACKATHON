import type { HardhatRuntimeEnvironment } from "hardhat/types";

type Deployed = Record<string, { address: string; constructorArguments: unknown[] }>;

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * SPEC §5.10, v1 subset (A1): NestRegistry, NestPassport, RentalEscrow and their wiring.
 * DisputeResolver and SocietyLedger arrive in v2 (A2/A3); until then RentalEscrow points at the
 * zero address for both, so leases must use flatId 0 and disputes are unavailable on v1.
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
  const resolverAddr = out.DisputeResolver?.address ?? ZERO;
  const ledgerAddr = out.SocietyLedger?.address ?? ZERO;
  await deploy("RentalEscrow", [out.NestRegistry.address, out.NestPassport.address, resolverAddr, ledgerAddr]);

  const MODULE = await registry.MODULE_ROLE();
  await send("MODULE_ROLE → RentalEscrow", registry.grantRole(MODULE, out.RentalEscrow.address));
  await send("ATTESTOR_ROLE → attestor", registry.grantRole(await registry.ATTESTOR_ROLE(), attestor));
  await send("VERIFIER_ROLE → admin", registry.grantRole(await registry.VERIFIER_ROLE(), admin.address));
  await send(`passport.setTierParams(${demo ? 2 : 6})`, passport.setTierParams(demo ? 2 : 6));

  return out;
}
