import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { BOND, HASH } from "./fixtures";
import { e, milestoneInput, projectInput } from "./fixturesA2";

const Kind = { PayVendor: 0, FundWork: 1, WorkDecision: 2, TankerOrder: 3 };
const PS = { Pending: 0, CommitteeApproved: 1, Executed: 2, Rejected: 3, Cancelled: 4 };
const CFG = { threshold: 3, tier1Limit: e("0.01"), tier2Limit: e("0.05"), quorumBps: 3000, votingPeriod: 120, attestTimeout: 60 };
const coder = ethers.AbiCoder.defaultAbiCoder();

async function deployA3() {
  const [admin, attestor, meera, rohan, c3, c4, c5, plumber, contractor, tenant, other, a1, a2, a3] = await ethers.getSigners();
  const registry = await (await ethers.getContractFactory("NestRegistry")).deploy(admin.address);
  const passport = await (await ethers.getContractFactory("NestPassport")).deploy(await registry.getAddress());
  await registry.setPassport(await passport.getAddress());
  const resolver = await (await ethers.getContractFactory("DisputeResolver")).deploy(await registry.getAddress(), await passport.getAddress(), BOND, 300);
  const ledger = await (await ethers.getContractFactory("SocietyLedger")).deploy(await registry.getAddress(), await passport.getAddress());
  const rental = await (await ethers.getContractFactory("RentalEscrow")).deploy(
    await registry.getAddress(), await passport.getAddress(), await resolver.getAddress(), await ledger.getAddress());
  const milestone = await (await ethers.getContractFactory("MilestoneEscrow")).deploy(
    await registry.getAddress(), await passport.getAddress(), await resolver.getAddress());
  const MODULE = await registry.MODULE_ROLE();
  for (const c of [resolver, ledger, rental, milestone]) await registry.grantRole(MODULE, await c.getAddress());
  await registry.grantRole(await registry.VERIFIER_ROLE(), admin.address);
  await registry.grantRole(await registry.ATTESTOR_ROLE(), attestor.address);
  await ledger.setModules(await rental.getAddress(), await milestone.getAddress(), ethers.ZeroAddress);
  for (const a of [a1, a2, a3]) await resolver.addArbiter(a.address);
  for (const w of [meera, rohan, c3, c4, c5, plumber, contractor, tenant]) {
    await registry.connect(w).register(0, ethers.ZeroHash);
    await registry.verify(w.address);
  }

  const committee = [meera, rohan, c3, c4, c5];
  await ledger.connect(meera).createSociety("Green Meadows Residency", HASH("meta"), committee.map((m) => m.address), CFG);
  // Flats: C-202 (meera), B-304 (rohan), D-101..103 (c3..c5), weights 10 each (total 50).
  const flats: Record<string, bigint> = {};
  for (const [label, owner] of [["C-202", meera], ["B-304", rohan], ["D-101", c3], ["D-102", c4], ["D-103", c5]] as const) {
    flats[label] = await ledger.nextFlatId();
    await ledger.connect(meera).addFlat(1, label, owner.address, 10, e("0.002"));
  }
  // Seed the treasury: one big maintenance payment.
  await ledger.connect(meera).payMaintenance(flats["C-202"], { value: e("1") });
  return { admin, attestor, meera, rohan, c3, c4, c5, plumber, contractor, tenant, other, committee, flats,
    registry, passport, resolver, ledger, rental, milestone };
}
type A3 = Awaited<ReturnType<typeof deployA3>>;

async function payVendor(c: A3, amount: bigint, proposer = c.meera) {
  const id = await c.ledger.nextProposalId();
  await c.ledger.connect(proposer).propose(1, Kind.PayVendor, c.plumber.address, amount, HASH(`invoice-${id}`), "plumbing", "0x");
  return id;
}

describe("SocietyLedger", () => {
  it("collects maintenance and routes a tenant's rent-share maintenance into the treasury", async () => {
    const c = await loadFixture(deployA3);
    expect((await c.ledger.getSociety(1)).balance).to.equal(e("1"));
    const lease = await c.rental.nextId();
    await c.rental.connect(c.rohan).offerLease({
      tenant: c.tenant.address, flatId: c.flats["B-304"], rent: e("0.03"), deposit: e("0.18"), useTrustPricing: false,
      baseDepositMonths: 6, period: 90, periods: 2, grace: 30, baselineWindow: 90, claimWindow: 120, responseWindow: 90,
      termsHash: HASH("t"),
    });
    await c.rental.connect(c.tenant).signLease(lease, { value: e("0.18") });
    expect((await c.ledger.getFlat(c.flats["B-304"])).tenant).to.equal(c.tenant.address);
    await expect(c.rental.connect(c.tenant).payRent(lease, { value: e("0.032") }))
      .to.emit(c.ledger, "MaintenancePaid").withArgs(1, c.flats["B-304"], await c.rental.getAddress(), e("0.002"));
    expect((await c.ledger.getSociety(1)).totalCollected).to.equal(e("1.002"));
    expect(await c.ledger.societiesOf(c.c3.address)).to.deep.equal([1n]);
  });

  it("tier comes from the vendor's month-to-date committed spend, so splitting a bill doesn't dodge approvals", async () => {
    const c = await loadFixture(deployA3);
    const p1 = await payVendor(c, e("0.008"));
    const p2 = await payVendor(c, e("0.008"));
    expect((await c.ledger.getProposal(p1)).tier).to.equal(0);
    expect((await c.ledger.getProposal(p2)).tier).to.equal(1); // 0.016 this month > tier1Limit
    expect(await c.ledger.requiredApprovals(p2)).to.equal(3);
    expect((await c.ledger.getSociety(1)).committed).to.equal(e("0.016"));
    expect(await c.ledger.availableBalance(1)).to.equal(e("0.984"));
  });

  it("only committee members propose, and never more than the available balance", async () => {
    const c = await loadFixture(deployA3);
    await expect(payVendor(c, e("0.001"), c.other)).to.be.revertedWithCustomError(c.ledger, "NotAuthorized");
    await expect(payVendor(c, e("1.5"))).to.be.revertedWithCustomError(c.ledger, "BadAmount");
  });

  it("the attestation gate holds a proposal until the AI attests or attestTimeout passes", async () => {
    const c = await loadFixture(deployA3);
    const id = await payVendor(c, e("0.0012"));
    expect(await c.ledger.canExecute(id)).to.deep.equal([false, "awaiting AI attestation"]);
    await expect(c.ledger.execute(id)).to.be.revertedWithCustomError(c.ledger, "BadStatus");
    await time.increase(CFG.attestTimeout);
    expect((await c.ledger.canExecute(id))[0]).to.equal(true);
    await expect(c.ledger.connect(c.other).execute(id)).to.changeEtherBalance(c.plumber, e("0.0012"));
    expect(await c.passport.statOf(c.plumber.address, 16)).to.equal(1); // InvoicesPaid
  });

  it("an AI flag never blocks: it escalates the tier, resets approvals and requires written override reasons", async () => {
    const c = await loadFixture(deployA3);
    const id = await payVendor(c, e("0.0048"));
    expect((await c.ledger.getProposal(id)).approvals).to.equal(1);
    await expect(c.ledger.connect(c.other).attestInvoice(id, HASH("r"), 80, true)).to.be.revertedWithCustomError(c.ledger, "NotAuthorized");
    await c.ledger.connect(c.attestor).attestInvoice(id, HASH("report"), 80, true);
    const p = await c.ledger.getProposal(id);
    expect(p.approvals).to.equal(0);
    expect(await c.ledger.effectiveTier(id)).to.equal(1);
    expect(await c.ledger.hasApproved(id, c.meera.address)).to.equal(false);

    await expect(c.ledger.connect(c.meera).approve(id, ethers.ZeroHash)).to.be.revertedWithCustomError(c.ledger, "BadInput");
    await c.ledger.connect(c.meera).approve(id, HASH("quoted twice, cheapest"));
    await c.ledger.connect(c.c3).approve(id, HASH("agree"));
    await expect(c.ledger.connect(c.c3).approve(id, HASH("again"))).to.be.revertedWithCustomError(c.ledger, "BadStatus");
    expect((await c.ledger.canExecute(id))[1]).to.equal("needs more committee approvals");
    await c.ledger.connect(c.c4).approve(id, HASH("agree"));
    await expect(c.ledger.execute(id)).to.changeEtherBalance(c.plumber, e("0.0048"));
    expect(await c.passport.statOf(c.meera.address, 21)).to.equal(1); // FlagOverrides
    expect(await c.passport.statOf(c.plumber.address, 17)).to.equal(1); // InvoicesFlagged
  });

  it("tier 2 needs committee approval, then a resident vote that meets quorum and majority", async () => {
    const c = await loadFixture(deployA3);
    const id = await payVendor(c, e("0.06"));
    expect((await c.ledger.getProposal(id)).tier).to.equal(2);
    await c.ledger.connect(c.rohan).approve(id, ethers.ZeroHash);
    await expect(c.ledger.connect(c.c3).approve(id, ethers.ZeroHash)).to.emit(c.ledger, "CommitteeApproved");
    expect((await c.ledger.getProposal(id)).status).to.equal(PS.CommitteeApproved);
    await c.ledger.connect(c.attestor).attestInvoice(id, HASH("clean report"), 10, false); // unflagged: nothing resets
    expect((await c.ledger.getProposal(id)).status).to.equal(PS.CommitteeApproved);

    // B-304 delegates to the tenant; the owner can no longer vote for that flat.
    await c.ledger.connect(c.rohan).delegateVote(c.flats["B-304"], c.tenant.address);
    await expect(c.ledger.connect(c.rohan).castVote(id, c.flats["B-304"], true)).to.be.revertedWithCustomError(c.ledger, "NotAuthorized");
    await c.ledger.connect(c.tenant).castVote(id, c.flats["B-304"], true);
    await c.ledger.connect(c.c4).castVote(id, c.flats["D-102"], false);
    await expect(c.ledger.connect(c.c4).castVote(id, c.flats["D-102"], true)).to.be.revertedWithCustomError(c.ledger, "BadStatus");
    await c.ledger.connect(c.c5).castVote(id, c.flats["D-103"], true);
    expect((await c.ledger.canExecute(id))[1]).to.equal("resident vote still open");
    await time.increase(CFG.votingPeriod);
    await expect(c.ledger.execute(id)).to.changeEtherBalance(c.plumber, e("0.06")); // 30 of 50 voted (quorum 30%), 20 for vs 10 against
  });

  it("a tier-2 vote without quorum is rejected and releases the reservation", async () => {
    const c = await loadFixture(deployA3);
    const id = await payVendor(c, e("0.06"));
    await c.ledger.connect(c.rohan).approve(id, ethers.ZeroHash);
    await c.ledger.connect(c.c3).approve(id, ethers.ZeroHash);
    await c.ledger.connect(c.c4).castVote(id, c.flats["D-102"], true); // 10 of 50 = 20% < 30%
    await time.increase(CFG.votingPeriod);
    await expect(c.ledger.execute(id)).to.emit(c.ledger, "ProposalRejected").withArgs(id);
    expect((await c.ledger.getProposal(id)).status).to.equal(PS.Rejected);
    expect((await c.ledger.getSociety(1)).committed).to.equal(0);
  });

  it("cancel releases the committed amount and the vendor's month total", async () => {
    const c = await loadFixture(deployA3);
    const id = await payVendor(c, e("0.008"));
    await expect(c.ledger.connect(c.rohan).cancel(id)).to.be.revertedWithCustomError(c.ledger, "NotAuthorized");
    await c.ledger.connect(c.meera).cancel(id);
    expect((await c.ledger.getSociety(1)).committed).to.equal(0);
    const month = (await c.ledger.getProposal(id)).month;
    expect(await c.ledger.vendorMonthCommitted(1, c.plumber.address, month)).to.equal(0);
  });

  it("FundWork creates a treasury-funded project; WorkDecision reworks and accepts it; refunds credit the society", async () => {
    const c = await loadFixture(deployA3);
    const ms = [milestoneInput([e("0.02"), e("0.02")], { title: "Terrace waterproofing" })];
    const p = projectInput(c.contractor.address, { responseWindow: 600, minScore: 80 });
    const data = coder.encode(
      ["tuple(address contractor, bytes32 specHash, uint32 responseWindow, uint32 reworkWindow, uint8 minScore, uint8 maxRounds, uint256 payerRef, uint256 flatId)",
        "tuple(string title, uint128[] lineItems, uint16 advanceBps, uint32 duration, bytes32 specHash)[]"],
      [p, ms]);
    const fund = await c.ledger.nextProposalId();
    await c.ledger.connect(c.meera).propose(1, Kind.FundWork, c.contractor.address, e("0.04"), HASH("quote"), "civil", data);
    await c.ledger.connect(c.rohan).approve(fund, ethers.ZeroHash);
    await c.ledger.connect(c.c3).approve(fund, ethers.ZeroHash);
    await time.increase(CFG.attestTimeout);
    const projectId = await c.milestone.nextId();
    await c.ledger.execute(fund);
    expect((await c.ledger.getProposal(fund)).resultRef).to.equal(projectId);
    const ag = await c.milestone.getAgreement(projectId);
    expect(ag.payer).to.equal(await c.ledger.getAddress());
    expect(ag.payerRef).to.equal(1);

    await c.milestone.connect(c.contractor).acceptProject(projectId);
    await c.milestone.connect(c.contractor).submitClaim(projectId, [e("0.02"), e("0.01")], HASH("site"));

    async function decide(action: number, mask: number) {
      const id = await c.ledger.nextProposalId();
      const d = coder.encode(["uint256", "uint8", "uint16", "bytes32"], [projectId, action, mask, HASH("reason")]);
      await c.ledger.connect(c.meera).propose(1, Kind.WorkDecision, c.contractor.address, 0, HASH("decision"), "civil", d);
      expect((await c.ledger.getProposal(id)).tier).to.equal(1); // work decisions always need the committee
      await c.ledger.connect(c.rohan).approve(id, ethers.ZeroHash);
      await c.ledger.connect(c.c3).approve(id, ethers.ZeroHash);
      await time.increase(CFG.attestTimeout);
      return c.ledger.execute(id);
    }

    await decide(2, 0b10); // rework item 1
    expect((await c.milestone.getTranche(projectId, 0)).round).to.equal(1);
    await c.milestone.connect(c.contractor).submitClaim(projectId, [e("0.02"), e("0.015")], HASH("site-2"));
    const balanceBefore = (await c.ledger.getSociety(1)).balance;
    // Accept: the contractor is paid; the unclaimed 0.005 goes back to the society via deposit().
    await expect(decide(0, 0)).to.emit(c.ledger, "Deposited").withArgs(1, await c.milestone.getAddress(), e("0.005"));
    expect((await c.ledger.getSociety(1)).balance).to.equal(balanceBefore + e("0.005"));
  });

  it("TankerOrder is rejected while no tanker module is set (TankerTrust is out of scope)", async () => {
    const c = await loadFixture(deployA3);
    const d = coder.encode(["uint32", "uint128", "address", "uint32"], [500, e("0.00001"), c.other.address, 600]);
    await expect(c.ledger.connect(c.meera).propose(1, Kind.TankerOrder, c.plumber.address, e("0.005"), HASH("o"), "water", d))
      .to.be.revertedWithCustomError(c.ledger, "BadInput");
  });

  it("setModules works once; only the rental module can set flat tenants", async () => {
    const c = await loadFixture(deployA3);
    await expect(c.ledger.setModules(c.other.address, c.other.address, c.other.address)).to.be.revertedWithCustomError(c.ledger, "BadStatus");
    await expect(c.ledger.connect(c.other).setFlatTenant(1, c.other.address)).to.be.revertedWithCustomError(c.ledger, "NotAuthorized");
  });
});
