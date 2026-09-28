import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { BOND, Stat, TS, HASH } from "./fixtures";
import { createKitchen, deployA2, e, milestoneInput, panel, PW, projectInput } from "./fixturesA2";

const PS = { AwaitingAcceptance: 0, Active: 1, Completed: 2, Cancelled: 3 };

describe("MilestoneEscrow", () => {
  it("create + accept pays the first materials advance", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    expect((await c.milestone.getAgreement(id)).trancheCount).to.equal(3);
    expect(await c.milestone.milestoneTitle(id, 1)).to.equal("Civil + electrical");
    await expect(c.milestone.connect(c.contractor).acceptProject(id)).to.changeEtherBalance(c.contractor, e("0.06"));
    expect((await c.milestone.getProject(id)).status).to.equal(PS.Active);
    expect((await c.milestone.getTranche(id, 0)).status).to.equal(TS.Open);
  });

  it("rejects bad projects: advance above 40%, wrong funding, contractor = payer", async () => {
    const c = await loadFixture(deployA2);
    const p = projectInput(c.contractor.address);
    await expect(c.milestone.connect(c.homeowner).createProject(p, [milestoneInput([e("0.1")], { advanceBps: 4001 })], { value: e("0.1") }))
      .to.be.revertedWithCustomError(c.milestone, "BadInput");
    await expect(c.milestone.connect(c.homeowner).createProject(p, [milestoneInput([e("0.1")])], { value: e("0.09") }))
      .to.be.revertedWithCustomError(c.milestone, "BadAmount");
    await expect(c.milestone.connect(c.contractor).createProject(p, [milestoneInput([e("0.1")])], { value: e("0.1") }))
      .to.be.revertedWithCustomError(c.milestone, "BadInput");
    await expect(c.milestone.connect(c.homeowner).createProject(projectInput(c.contractor.address, { payerRef: 1 }), [milestoneInput([e("0.1")])], { value: e("0.1") }))
      .to.be.revertedWithCustomError(c.milestone, "NotAuthorized");
  });

  it("cancelUnaccepted refunds everything", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await expect(c.milestone.connect(c.homeowner).cancelUnaccepted(id)).to.changeEtherBalance(c.homeowner, e("0.5"));
    expect((await c.milestone.getProject(id)).status).to.equal(PS.Cancelled);
  });

  it("approve pays the rest of the milestone and opens the next one with its advance", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    await c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("photos"));
    // rest of milestone 0 (0.2 − 0.06) + advance of milestone 1 (30% of 0.2)
    await expect(c.milestone.connect(c.homeowner).respond(id, 0)).to.changeEtherBalance(c.contractor, e("0.2"));
    expect((await c.milestone.getAgreement(id)).current).to.equal(1);
    expect((await c.milestone.getTranche(id, 1)).status).to.equal(TS.Open);
    expect(await c.passport.statOf(c.contractor.address, 7)).to.equal(1);   // MilestonesApproved
    expect(await c.passport.statOf(c.contractor.address, 8)).to.equal(1);   // MilestonesOnTime
    expect(await c.passport.statOf(c.homeowner.address, Stat.PromptDecisions)).to.equal(1);
  });

  it("runs all three milestones to completion", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    for (const items of [[e("0.1"), e("0.1")], [e("0.2")], [e("0.1")]]) {
      await c.milestone.connect(c.contractor).submitClaim(id, items, HASH("photos"));
      await c.milestone.connect(c.homeowner).respond(id, 0);
    }
    expect((await c.milestone.getProject(id)).status).to.equal(PS.Completed);
    expect(await c.passport.statOf(c.contractor.address, 10)).to.equal(1); // ProjectsCompleted
    expect(await ethers.provider.getBalance(await c.milestone.getAddress())).to.equal(0);
  });

  it("rework reopens the claim for a new round, up to maxRounds; stale attestations are rejected", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c, { maxRounds: 1 });
    await c.milestone.connect(c.contractor).acceptProject(id);
    await c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("r0"));
    await expect(c.milestone.connect(c.homeowner).requestRework(id, 0b10, HASH("tiles uneven")))
      .to.emit(c.milestone, "ReworkRequested");
    const t = await c.milestone.getTranche(id, 0);
    expect(t.round).to.equal(1);
    expect(t.status).to.equal(TS.Open);
    await c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("r1"));
    await expect(c.milestone.connect(c.attestor).attest(id, 0, HASH("old"), [e("0.1"), e("0.1")], 90))
      .to.be.revertedWithCustomError(c.milestone, "BadInput");
    await expect(c.milestone.connect(c.homeowner).requestRework(id, 0b10, HASH("again")))
      .to.be.revertedWithCustomError(c.milestone, "BadStatus");
  });

  it("silence with score ≥ minScore releases the backed items (contractor protection)", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    await c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("photos"));
    await c.milestone.connect(c.attestor).attest(id, 0, HASH("att"), [e("0.1"), e("0.1")], 88);
    await time.increase(PW.responseWindow + 1);
    await expect(c.milestone.finalizeAfterSilence(id)).to.changeEtherBalance(c.contractor, e("0.2"));
    expect(await c.passport.statOf(c.homeowner.address, Stat.SilentDecisions)).to.equal(1);
  });

  it("silence with score < minScore escalates to arbiters instead", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    await c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("photos"));
    await c.milestone.connect(c.attestor).attest(id, 0, HASH("att"), [e("0.1"), e("0.1")], 70);
    await time.increase(PW.responseWindow + 1);
    await expect(c.milestone.finalizeAfterSilence(id)).to.emit(c.milestone, "DisputeEscalated").withArgs(id, 0, 1, 0b11, true);
    expect((await c.milestone.getTranche(id, 0)).status).to.equal(TS.Disputed);
  });

  it("stall: the homeowner cancels after the deadline, gets all unreleased money back, contractor marked abandoned", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    await time.increase(PW.duration + 1);
    await expect(c.milestone.connect(c.other).finalizeNoClaim(id)).to.be.revertedWithCustomError(c.milestone, "NotAuthorized");
    // (0.2 − 0.06 advance) + 0.2 + 0.1
    await expect(c.milestone.connect(c.homeowner).finalizeNoClaim(id)).to.changeEtherBalance(c.homeowner, e("0.44"));
    expect((await c.milestone.getProject(id)).status).to.equal(PS.Cancelled);
    expect(await c.passport.statOf(c.contractor.address, 11)).to.equal(1); // ProjectsAbandoned
    expect(await ethers.provider.getBalance(await c.milestone.getAddress())).to.equal(0);
  });

  it("a late claim is still accepted and recorded as late", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    await time.increase(PW.duration + 1);
    await expect(c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("late")))
      .to.emit(c.milestone, "ClaimSubmitted").withArgs(id, 0, 0, [e("0.1"), e("0.1")], HASH("late"), true);
    await c.milestone.connect(c.homeowner).respond(id, 0);
    expect(await c.passport.statOf(c.contractor.address, 9)).to.equal(1); // MilestonesLate
  });

  it("an award below the advance doesn't underflow: the advance stays with the contractor", async () => {
    const c = await loadFixture(deployA2);
    const id = await createKitchen(c);
    await c.milestone.connect(c.contractor).acceptProject(id);
    await c.milestone.connect(c.contractor).submitClaim(id, [e("0.1"), e("0.1")], HASH("photos"));
    await c.milestone.connect(c.homeowner).respond(id, 0b11, { value: await c.resolver.disputeBond() });
    const [x, y] = await panel(c, 1);
    await c.resolver.connect(x).vote(1, 0, HASH("no"));
    // Both items rejected → contractor keeps only the 0.06 advance; homeowner gets 0.14 back, then milestone 1 opens.
    await expect(c.resolver.connect(y).vote(1, 0, HASH("no"))).to.changeEtherBalance(c.homeowner, e("0.14") + BOND); // + bond back: the homeowner won
    const t = await c.milestone.getTranche(id, 0);
    expect(t.released).to.equal(e("0.06"));
    expect(t.released + t.refunded).to.equal(t.amount);
  });

  describe("change orders", () => {
    async function active(c: Awaited<ReturnType<typeof deployA2>>) {
      const id = await createKitchen(c);
      await c.milestone.connect(c.contractor).acceptProject(id);
      return id;
    }

    it("modify an unopened milestone: the payer funds the increase up front", async () => {
      const c = await loadFixture(deployA2);
      const id = await active(c);
      const m = milestoneInput([e("0.15")], { title: "Finishing + false ceiling" });
      await expect(c.milestone.connect(c.homeowner).proposeChangeOrder(id, 2, m, HASH("why"), { value: e("0.04") }))
        .to.be.revertedWithCustomError(c.milestone, "BadAmount");
      await c.milestone.connect(c.homeowner).proposeChangeOrder(id, 2, m, HASH("why"), { value: e("0.05") });
      await c.milestone.connect(c.contractor).approveChangeOrder(id, 0);
      expect((await c.milestone.getTranche(id, 2)).amount).to.equal(e("0.15"));
      expect(await c.milestone.milestoneTitle(id, 2)).to.equal("Finishing + false ceiling");
    });

    it("append: the contractor proposes, the payer funds on approval", async () => {
      const c = await loadFixture(deployA2);
      const id = await active(c);
      await c.milestone.connect(c.contractor).proposeChangeOrder(id, 3, milestoneInput([e("0.05")], { title: "Handover" }), HASH("add"));
      await expect(c.milestone.connect(c.homeowner).approveChangeOrder(id, 0)).to.be.revertedWithCustomError(c.milestone, "BadAmount");
      await c.milestone.connect(c.homeowner).approveChangeOrder(id, 0, { value: e("0.05") });
      expect((await c.milestone.getAgreement(id)).trancheCount).to.equal(4);
    });

    it("a decrease is refunded to the payer; a rejected change order returns its funding", async () => {
      const c = await loadFixture(deployA2);
      const id = await active(c);
      await c.milestone.connect(c.contractor).proposeChangeOrder(id, 1, milestoneInput([e("0.1")]), HASH("smaller"));
      await expect(c.milestone.connect(c.homeowner).approveChangeOrder(id, 0)).to.changeEtherBalance(c.homeowner, e("0.1"));

      await c.milestone.connect(c.homeowner).proposeChangeOrder(id, 2, milestoneInput([e("0.3")]), HASH("bigger"), { value: e("0.2") });
      await expect(c.milestone.connect(c.contractor).rejectChangeOrder(id, 1)).to.changeEtherBalance(c.homeowner, e("0.2"));
      await expect(c.milestone.connect(c.contractor).approveChangeOrder(id, 1)).to.be.revertedWithCustomError(c.milestone, "BadStatus");
    });

    it("cannot change an opened milestone, and a stale change order cannot be approved", async () => {
      const c = await loadFixture(deployA2);
      const id = await active(c);
      await expect(c.milestone.connect(c.homeowner).proposeChangeOrder(id, 0, milestoneInput([e("0.1")]), HASH("x")))
        .to.be.revertedWithCustomError(c.milestone, "BadInput");
      await c.milestone.connect(c.contractor).proposeChangeOrder(id, 2, milestoneInput([e("0.05")]), HASH("a"));
      await c.milestone.connect(c.contractor).proposeChangeOrder(id, 2, milestoneInput([e("0.08")]), HASH("b"));
      await c.milestone.connect(c.homeowner).approveChangeOrder(id, 0);
      await expect(c.milestone.connect(c.homeowner).approveChangeOrder(id, 1)).to.be.revertedWithCustomError(c.milestone, "BadStatus");
    });
  });
});
