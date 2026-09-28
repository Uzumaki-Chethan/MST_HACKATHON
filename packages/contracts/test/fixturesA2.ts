import { ethers } from "hardhat";
import { BOND, Kind } from "./fixtures";

export const VOTING = 300;
export const PW = { responseWindow: 90, reworkWindow: 180, duration: 300 };
export const e = (n: string) => ethers.parseEther(n);

/** Real DisputeResolver (4 arbiters) wired to RentalEscrow and MilestoneEscrow. */
export async function deployA2() {
  const s = await ethers.getSigners();
  const [admin, attestor, landlord, tenant, homeowner, contractor, other, a1, a2, a3, a4] = s;
  const registry = await (await ethers.getContractFactory("NestRegistry")).deploy(admin.address);
  const passport = await (await ethers.getContractFactory("NestPassport")).deploy(await registry.getAddress());
  await registry.setPassport(await passport.getAddress());
  const resolver = await (await ethers.getContractFactory("DisputeResolver")).deploy(
    await registry.getAddress(), await passport.getAddress(), BOND, VOTING);
  const ledger = await (await ethers.getContractFactory("MockLedger")).deploy();
  const rental = await (await ethers.getContractFactory("RentalEscrow")).deploy(
    await registry.getAddress(), await passport.getAddress(), await resolver.getAddress(), await ledger.getAddress());
  const milestone = await (await ethers.getContractFactory("MilestoneEscrow")).deploy(
    await registry.getAddress(), await passport.getAddress(), await resolver.getAddress());

  const MODULE = await registry.MODULE_ROLE();
  for (const c of [resolver, rental, milestone]) await registry.grantRole(MODULE, await c.getAddress());
  await registry.grantRole(await registry.VERIFIER_ROLE(), admin.address);
  await registry.grantRole(await registry.ATTESTOR_ROLE(), attestor.address);
  await passport.setTierParams(2);
  for (const [w, k] of [[landlord, Kind.LANDLORD], [tenant, Kind.TENANT], [homeowner, 4], [contractor, 8]] as const) {
    await registry.connect(w).register(k, ethers.ZeroHash);
    await registry.verify(w.address);
  }
  for (const a of [a1, a2, a3, a4]) await resolver.addArbiter(a.address);

  return { admin, attestor, landlord, tenant, homeowner, contractor, other, a1, a2, a3, a4,
    registry, passport, resolver, ledger, rental, milestone };
}
export type A2 = Awaited<ReturnType<typeof deployA2>>;

export function milestoneInput(lineItems: bigint[], over: Partial<Record<string, unknown>> = {}) {
  return { title: "Milestone", lineItems, advanceBps: 3000, duration: PW.duration, specHash: ethers.id("spec"), ...over };
}

export function projectInput(contractor: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    contractor, specHash: ethers.id("project"), responseWindow: PW.responseWindow, reworkWindow: PW.reworkWindow,
    minScore: 80, maxRounds: 2, payerRef: 0, flatId: 0, ...over,
  };
}

/** Kitchen: demolition 0.2 (two items), civil 0.2, finishing 0.1. Returns the project id (not yet accepted). */
export async function createKitchen(c: A2, over: Partial<Record<string, unknown>> = {}) {
  const ms = [
    milestoneInput([e("0.1"), e("0.1")], { title: "Demolition" }),
    milestoneInput([e("0.2")], { title: "Civil + electrical" }),
    milestoneInput([e("0.1")], { title: "Finishing" }),
  ];
  const id = await c.milestone.nextId();
  await c.milestone.connect(c.homeowner).createProject(projectInput(c.contractor.address, over), ms, { value: e("0.5") });
  return id;
}

/** Arbiters currently on a dispute's panel, as signers. */
export async function panel(c: A2, disputeId: bigint | number) {
  const d = await c.resolver.getDispute(disputeId);
  const all = [c.a1, c.a2, c.a3, c.a4];
  return d.arbiters.map((addr: string) => all.find((a) => a.address === addr)!);
}
