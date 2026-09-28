import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { BOND, BS, DEPOSIT, deployCore, HASH, LS, MAINT, offer, RENT, Stat, toMoveOut, TS, W, type Core } from "./fixtures";

const e = (n: string) => ethers.parseEther(n);

async function expectClosedAndBalanced(c: Core, id: bigint) {
  const t = await c.rental.getTranche(id, 0);
  expect(t.released + t.refunded).to.equal(t.amount);
  expect((await c.rental.getLease(id)).status).to.equal(LS.Closed);
}

describe("RentalEscrow: happy path", () => {
  it("offer → sign → baseline → confirm → pay ×2 → move-out → claim → attest → accept", async () => {
    const c = await loadFixture(deployCore);
    const { rental, ledger, landlord, tenant, attestor } = c;
    const id = await offer(c, { flatId: 1 });
    const lease = await rental.getLease(id);
    expect(lease.maintenance).to.equal(MAINT);
    expect(lease.societyId).to.equal(1);

    await expect(rental.connect(tenant).signLease(id, { value: DEPOSIT }))
      .to.changeEtherBalances([tenant, rental], [-DEPOSIT, DEPOSIT]);
    expect((await ledger.flats(1)).tenant).to.equal(tenant.address);

    await rental.connect(tenant).submitBaseline(id, HASH("baseline-bundle"), HASH("move-in-report"));
    await expect(rental.connect(landlord).confirmBaseline(id)).to.emit(rental, "BaselineConfirmed");
    expect((await rental.getLease(id)).baseline).to.equal(BS.Agreed);

    for (let k = 0; k < 2; k++) {
      await expect(rental.connect(tenant).payRent(id, { value: RENT + MAINT }))
        .to.changeEtherBalances([landlord, ledger], [RENT, MAINT]);
    }
    expect(await ledger.maintenancePaid(1)).to.equal(2n * MAINT);
    await expect(rental.connect(tenant).payRent(id, { value: RENT + MAINT })).to.be.revertedWithCustomError(rental, "BadStatus");

    await rental.connect(tenant).startMoveOut(id, HASH("out"));
    expect((await rental.getLease(id)).unpaidDues).to.equal(0);
    const tile = e("0.00045"); // ₹450 cracked tile
    await expect(rental.connect(landlord).submitClaim(id, [0, tile], HASH("claim")))
      .to.emit(rental, "ClaimSubmitted").withArgs(id, 0, 0, [0, tile], HASH("claim"), false);
    await expect(rental.connect(attestor).attest(id, 0, HASH("att"), [0, tile], 90)).to.emit(rental, "Attested");
    expect(await rental.backedMask(id)).to.equal(0b11);

    await expect(rental.connect(tenant).respond(id, 0))
      .to.changeEtherBalances([landlord, tenant, rental], [tile, DEPOSIT - tile, -DEPOSIT]);
    await expectClosedAndBalanced(c, id);
    expect((await ledger.flats(1)).tenant).to.equal(ethers.ZeroAddress);
    expect(await c.passport.statOf(tenant.address, Stat.LeasesCompleted)).to.equal(1);
    expect(await c.passport.statOf(landlord.address, Stat.DepositsReturned)).to.equal(1);
    expect(await c.passport.statOf(tenant.address, Stat.PromptDecisions)).to.equal(1);
  });

  it("trust pricing halves the deposit for a Tier 3 tenant", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await c.rental.connect(c.landlord).releaseDepositInFull(id);
    const id2 = await offer(c, { useTrustPricing: true, baseDepositMonths: 6, deposit: 0 }, c.landlord2);
    expect((await c.rental.getLease(id2)).deposit).to.equal(RENT * 3n);
  });

  it("a late rent payment is recorded as late", async () => {
    const c = await loadFixture(deployCore);
    const id = await offer(c);
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await time.increase(W.grace + 5);
    const [, , , overdue] = await c.rental.rentDueInfo(id);
    expect(overdue).to.equal(true);
    await expect(c.rental.connect(c.tenant).payRent(id, { value: RENT })).to.emit(c.rental, "RentPaid").withArgs(id, 0, RENT, 0, false);
    expect((await c.rental.getLease(id)).latePeriods).to.equal(1);
    expect(await c.passport.statOf(c.tenant.address, Stat.RentLate)).to.equal(1);
  });
});

describe("RentalEscrow: timeouts", () => {
  it("baseline is presumed accepted after the window, and can no longer be confirmed", async () => {
    const c = await loadFixture(deployCore);
    const id = await offer(c);
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await c.rental.connect(c.tenant).submitBaseline(id, HASH("b"), HASH("r"));
    await expect(c.rental.connect(c.other).finalizeBaseline(id)).to.be.revertedWithCustomError(c.rental, "WindowOpen");
    await time.increase(W.baselineWindow + 1);
    await expect(c.rental.connect(c.other).finalizeBaseline(id)).to.emit(c.rental, "BaselinePresumed");
    expect((await c.rental.getLease(id)).baseline).to.equal(BS.PresumedAccepted);
    await expect(c.rental.connect(c.landlord).confirmBaseline(id)).to.be.revertedWithCustomError(c.rental, "BadStatus");
  });

  it("the landlord documents first only after the tenant's window; the tenant can contest", async () => {
    const c = await loadFixture(deployCore);
    const id = await offer(c);
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await expect(c.rental.connect(c.landlord).submitBaseline(id, HASH("lb"), HASH("lr")))
      .to.be.revertedWithCustomError(c.rental, "WindowOpen");
    await time.increase(W.baselineWindow + 1);
    await c.rental.connect(c.landlord).submitBaseline(id, HASH("lb"), HASH("lr"));
    await expect(c.rental.connect(c.landlord).confirmBaseline(id)).to.be.revertedWithCustomError(c.rental, "NotParty");
    await expect(c.rental.connect(c.tenant).contestBaseline(id, HASH("counter")))
      .to.emit(c.rental, "BaselineContested").withArgs(id, c.tenant.address, HASH("counter"));
    expect((await c.rental.getLease(id)).baseline).to.equal(BS.Contested);
  });

  it("finalizeNoClaim refunds the whole deposit to the tenant after the claim window", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await expect(c.rental.connect(c.other).finalizeNoClaim(id)).to.be.revertedWithCustomError(c.rental, "WindowOpen");
    await time.increase(W.claimWindow + 1);
    await expect(c.rental.connect(c.other).finalizeNoClaim(id)).to.changeEtherBalance(c.tenant, DEPOSIT);
    await expectClosedAndBalanced(c, id);
    expect(await c.passport.statOf(c.tenant.address, Stat.DepositFullRefunds)).to.equal(1);
  });

  it("a late landlord claim reverts", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await time.increase(W.claimWindow + 1);
    await expect(c.rental.connect(c.landlord).submitClaim(id, [0, e("0.01")], HASH("late")))
      .to.be.revertedWithCustomError(c.rental, "WindowClosed");
  });

  it("releaseDepositInFull returns everything, landlord only", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await expect(c.rental.connect(c.tenant).releaseDepositInFull(id)).to.be.revertedWithCustomError(c.rental, "NotParty");
    await expect(c.rental.connect(c.landlord).releaseDepositInFull(id)).to.changeEtherBalance(c.tenant, DEPOSIT);
    await expectClosedAndBalanced(c, id);
  });

  it("move-out cannot start before the term ends unless all rent is paid", async () => {
    const c = await loadFixture(deployCore);
    const id = await offer(c);
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await expect(c.rental.connect(c.tenant).startMoveOut(id, HASH("o"))).to.be.revertedWithCustomError(c.rental, "WindowOpen");
  });
});

describe("RentalEscrow: claims", () => {
  it("a claim above the deposit reverts", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await expect(c.rental.connect(c.landlord).submitClaim(id, [0, DEPOSIT, 1], HASH("greedy")))
      .to.be.revertedWithCustomError(c.rental, "BadAmount");
  });

  it("partial dispute pays undisputed items and the unclaimed remainder immediately", async () => {
    const c = await loadFixture(deployCore);
    const { rental, resolver, landlord, tenant, attestor } = c;
    const id = await toMoveOut(c);
    const tile = e("0.00045"), repaint = e("0.006");
    await rental.connect(landlord).submitClaim(id, [0, tile, repaint], HASH("claim"));
    await rental.connect(attestor).attest(id, 0, HASH("att"), [0, tile, 0], 85);
    expect(await rental.backedMask(id)).to.equal(0b011);

    await expect(rental.connect(tenant).respond(id, 0b100, { value: 1 })).to.be.revertedWithCustomError(rental, "BadAmount");
    const untouched = DEPOSIT - tile - repaint;
    await expect(rental.connect(tenant).respond(id, 0b100, { value: BOND }))
      .to.changeEtherBalances([landlord, tenant, resolver], [tile, untouched - BOND, BOND]);
    expect((await rental.getTranche(id, 0)).status).to.equal(TS.Disputed);
    expect(await ethers.provider.getBalance(await rental.getAddress())).to.equal(repaint); // only the disputed item is frozen

    // Arbiters reject the repaint: it goes back to the tenant.
    await expect(resolver.resolve(1, 0)).to.changeEtherBalance(tenant, repaint);
    await expectClosedAndBalanced(c, id);
    expect(await c.passport.statOf(landlord.address, Stat.DeductionsRejected)).to.equal(1);
    expect(await c.passport.statOf(landlord.address, Stat.DepositsReturned)).to.equal(0);
  });

  it("an upheld dispute pays the landlord", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    const x = e("0.01");
    await c.rental.connect(c.landlord).submitClaim(id, [0, x], HASH("claim"));
    await c.rental.connect(c.tenant).respond(id, 0b10, { value: BOND });
    await expect(c.resolver.resolve(1, 0b10)).to.changeEtherBalance(c.landlord, x);
    await expectClosedAndBalanced(c, id);
    expect(await c.passport.statOf(c.landlord.address, Stat.DeductionsUpheld)).to.equal(1);
  });

  it("silence with every item backed settles", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    const x = e("0.002");
    await c.rental.connect(c.landlord).submitClaim(id, [0, x], HASH("claim"));
    await c.rental.connect(c.attestor).attest(id, 0, HASH("att"), [0, x], 70);
    await expect(c.rental.finalizeAfterSilence(id)).to.be.revertedWithCustomError(c.rental, "WindowOpen");
    await time.increase(W.responseWindow + 1);
    await expect(c.rental.connect(c.other).finalizeAfterSilence(id))
      .to.changeEtherBalances([c.landlord, c.tenant], [x, DEPOSIT - x]);
    await expectClosedAndBalanced(c, id);
    expect(await c.passport.statOf(c.tenant.address, Stat.SilentDecisions)).to.equal(1);
  });

  it("silence with unbacked items escalates them with no bond", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    const x = e("0.002"), y = e("0.03");
    await c.rental.connect(c.landlord).submitClaim(id, [0, x, y], HASH("claim"));
    await c.rental.connect(c.attestor).attest(id, 0, HASH("att"), [0, x, e("0.01")], 70);
    await time.increase(W.responseWindow + 1);
    await expect(c.rental.finalizeAfterSilence(id))
      .to.emit(c.rental, "SilenceFinalized").withArgs(id, 0, 0b011, 0b100)
      .and.to.emit(c.rental, "DisputeEscalated").withArgs(id, 0, 1, 0b100, true);
    const d = await c.resolver.opened(1);
    expect(d.bondPayer).to.equal(ethers.ZeroAddress);
    expect(d.mask).to.equal(0b100);
    expect(await ethers.provider.getBalance(await c.rental.getAddress())).to.equal(y);
  });

  it("unpaid rent (item 0) is backed by contract records without any attestation", async () => {
    const c = await loadFixture(deployCore);
    const id = await offer(c);
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await time.increase(W.period * W.periods);
    await c.rental.connect(c.landlord).startMoveOut(id, HASH("out"));
    expect((await c.rental.getLease(id)).unpaidDues).to.equal(RENT);
    await c.rental.connect(c.landlord).submitClaim(id, [RENT], HASH("rent"));
    expect(await c.rental.isBacked(id, 0)).to.equal(true);
    await time.increase(W.responseWindow + 1);
    await expect(c.rental.finalizeAfterSilence(id)).to.changeEtherBalance(c.landlord, RENT);
  });

  it("attestation guards: attestor only, current round only, once per round", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await c.rental.connect(c.landlord).submitClaim(id, [0, 1], HASH("claim"));
    await expect(c.rental.connect(c.other).attest(id, 0, HASH("a"), [0, 1], 50)).to.be.revertedWithCustomError(c.rental, "NotAuthorized");
    await expect(c.rental.connect(c.attestor).attest(id, 1, HASH("a"), [0, 1], 50)).to.be.revertedWithCustomError(c.rental, "BadInput");
    await expect(c.rental.connect(c.attestor).attest(id, 0, HASH("a"), [0], 50)).to.be.revertedWithCustomError(c.rental, "BadInput");
    await c.rental.connect(c.attestor).attest(id, 0, HASH("a"), [0, 1], 50);
    await expect(c.rental.connect(c.attestor).attest(id, 0, HASH("a"), [0, 1], 50)).to.be.revertedWithCustomError(c.rental, "BadStatus");
  });

  it("only the tenant responds, and only inside the window", async () => {
    const c = await loadFixture(deployCore);
    const id = await toMoveOut(c);
    await c.rental.connect(c.landlord).submitClaim(id, [0, 1], HASH("claim"));
    await expect(c.rental.connect(c.landlord).respond(id, 0)).to.be.revertedWithCustomError(c.rental, "NotParty");
    await expect(c.rental.connect(c.tenant).respond(id, 0b100, { value: BOND })).to.be.revertedWithCustomError(c.rental, "BadInput");
    await time.increase(W.responseWindow + 1);
    await expect(c.rental.connect(c.tenant).respond(id, 0)).to.be.revertedWithCustomError(c.rental, "WindowClosed");
  });
});
