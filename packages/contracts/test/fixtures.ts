import { ethers } from "hardhat";

export const RENT = ethers.parseEther("0.03");        // ₹30,000 at the demo rate
export const MAINT = ethers.parseEther("0.002");      // ₹2,000
export const DEPOSIT = ethers.parseEther("0.18");     // ₹1,80,000
export const BOND = ethers.parseEther("0.001");
export const W = { period: 90, periods: 2, grace: 30, baselineWindow: 90, claimWindow: 120, responseWindow: 90 };
export const HASH = (s: string) => ethers.id(s);
export const Kind = { TENANT: 1, LANDLORD: 2 };
export const Stat = { RentOnTime: 0, RentLate: 1, LeasesCompleted: 2, DepositFullRefunds: 3, DepositsReturned: 4,
  DeductionsUpheld: 5, DeductionsRejected: 6, PromptDecisions: 12, SilentDecisions: 13 };
export const TS = { Pending: 0, Open: 1, Claimed: 2, Disputed: 3, Settled: 4, Refunded: 5 };
export const LS = { Offered: 0, Active: 1, MovingOut: 2, Closed: 3, Cancelled: 4 };
export const BS = { None: 0, Submitted: 1, Agreed: 2, Contested: 3, PresumedAccepted: 4 };

export async function deployCore() {
  const [admin, attestor, landlord, tenant, other, landlord2] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("NestRegistry")).deploy(admin.address);
  const passport = await (await ethers.getContractFactory("NestPassport")).deploy(await registry.getAddress());
  await registry.setPassport(await passport.getAddress());
  const ledger = await (await ethers.getContractFactory("MockLedger")).deploy();
  const resolver = await (await ethers.getContractFactory("MockResolver")).deploy(BOND);
  const rental = await (await ethers.getContractFactory("RentalEscrow")).deploy(
    await registry.getAddress(), await passport.getAddress(), await resolver.getAddress(), await ledger.getAddress());

  await registry.grantRole(await registry.MODULE_ROLE(), await rental.getAddress());
  await registry.grantRole(await registry.VERIFIER_ROLE(), admin.address);
  await registry.grantRole(await registry.ATTESTOR_ROLE(), attestor.address);
  await passport.setTierParams(2);

  for (const [s, k] of [[landlord, Kind.LANDLORD], [tenant, Kind.TENANT], [landlord2, Kind.LANDLORD]] as const) {
    await registry.connect(s).register(k, ethers.ZeroHash);
    await registry.verify(s.address);
  }
  await ledger.setFlat(1, 1, landlord.address, MAINT); // B-304 in society 1, owned by the landlord

  return { admin, attestor, landlord, tenant, other, landlord2, registry, passport, ledger, resolver, rental };
}

export type Core = Awaited<ReturnType<typeof deployCore>>;

export function terms(tenant: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    tenant, flatId: 0, rent: RENT, deposit: DEPOSIT, useTrustPricing: false, baseDepositMonths: 6,
    ...W, termsHash: HASH("terms"), ...over,
  };
}

/** Offers a lease from `landlord` and returns its id. */
export async function offer(c: Core, over: Partial<Record<string, unknown>> = {}, landlord = c.landlord) {
  const id = await c.rental.nextId();
  await c.rental.connect(landlord).offerLease(terms(c.tenant.address, over));
  return id;
}

/** Offer → sign → pay every period on time → move-out. Returns the lease id with the deposit tranche Open. */
export async function toMoveOut(c: Core, over: Partial<Record<string, unknown>> = {}) {
  const id = await offer(c, over);
  const lease0 = await c.rental.getLease(id);
  await c.rental.connect(c.tenant).signLease(id, { value: lease0.deposit });
  const due = lease0.rent + lease0.maintenance;
  for (let i = 0; i < W.periods; i++) await c.rental.connect(c.tenant).payRent(id, { value: due });
  await c.rental.connect(c.tenant).startMoveOut(id, HASH("move-out-bundle"));
  return id;
}
