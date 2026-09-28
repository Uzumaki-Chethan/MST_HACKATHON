import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { BOND, DEPOSIT, HASH, RENT, Stat, TS, terms } from "./fixtures";
import { deployA2, e, panel, VOTING, type A2 } from "./fixturesA2";

/** Rental at move-out with a claim of [0, tile, repaint]; tenant disputes `mask`. Returns lease id. */
async function disputedRental(c: A2, mask: number, withBond = true) {
  const id = await c.rental.nextId();
  await c.rental.connect(c.landlord).offerLease(terms(c.tenant.address));
  await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
  await c.rental.connect(c.tenant).payRent(id, { value: RENT });
  await c.rental.connect(c.tenant).payRent(id, { value: RENT });
  await c.rental.connect(c.tenant).startMoveOut(id, HASH("out"));
  await c.rental.connect(c.landlord).submitClaim(id, [0, e("0.00045"), e("0.006")], HASH("claim"));
  await c.rental.connect(c.tenant).respond(id, mask, { value: withBond ? BOND : 0 });
  return id;
}

describe("DisputeResolver", () => {
  it("two matching votes resolve the dispute and the escrow pays out in the same tx", async () => {
    const c = await loadFixture(deployA2);
    const id = await disputedRental(c, 0b100);
    expect(await c.resolver.disputeFor(await c.rental.getAddress(), id, 0)).to.equal(1);
    const [x, y] = await panel(c, 1);
    await c.resolver.connect(x).vote(1, 0, HASH("normal wear"));
    expect((await c.rental.getTranche(id, 0)).status).to.equal(TS.Disputed);
    // Repaint rejected → the tenant gets it back, plus the bond (the disputer won).
    const tx = c.resolver.connect(y).vote(1, 0, HASH("agree"));
    await expect(tx).to.changeEtherBalance(c.tenant, e("0.006") + BOND);
    await expect(tx).to.emit(c.resolver, "DisputeResolved").withArgs(1, 0, false, 0, e("0.006"));
    expect((await c.rental.getTranche(id, 0)).status).to.equal(TS.Settled);
    expect(await c.passport.statOf(c.tenant.address, 14 /* DisputesWon */)).to.equal(1);
  });

  it("split votes wait for the third arbiter, then decide per item", async () => {
    const c = await loadFixture(deployA2);
    await disputedRental(c, 0b110);
    const [x, y, z] = await panel(c, 1);
    await c.resolver.connect(x).vote(1, 0b110, HASH("uphold both"));
    await c.resolver.connect(y).vote(1, 0, HASH("reject both"));
    expect((await c.resolver.getDispute(1)).status).to.equal(0); // still open
    // z upholds the tile only → tile 2 up / 1 down (upheld), repaint 1 up / 2 down (rejected)
    await expect(c.resolver.connect(z).vote(1, 0b010, HASH("tile yes, repaint no")))
      .to.emit(c.resolver, "DisputeResolved").withArgs(1, 0b010, false, e("0.00045"), e("0.00645"));
  });

  it("parties are never on their own panel", async () => {
    const c = await loadFixture(deployA2);
    await c.resolver.addArbiter(c.tenant.address);
    await c.resolver.addArbiter(c.landlord.address);
    await disputedRental(c, 0b100);
    const d = await c.resolver.getDispute(1);
    expect(d.arbiters).to.not.include(c.tenant.address);
    expect(d.arbiters).to.not.include(c.landlord.address);
  });

  it("when the payee wins, the bond is split among the arbiters who voted", async () => {
    const c = await loadFixture(deployA2);
    await disputedRental(c, 0b100);
    const [x, y] = await panel(c, 1);
    await c.resolver.connect(x).vote(1, 0b100, HASH("damage is real"));
    await expect(c.resolver.connect(y).vote(1, 0b100, HASH("agree")))
      .to.changeEtherBalances([x, y, c.landlord], [BOND / 2n, BOND / 2n, e("0.006")]);
  });

  it("silence-escalated disputes carry no bond", async () => {
    const c = await loadFixture(deployA2);
    const id = await c.rental.nextId();
    await c.rental.connect(c.landlord).offerLease(terms(c.tenant.address));
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await c.rental.connect(c.tenant).startMoveOut(id, HASH("out"));
    await c.rental.connect(c.landlord).submitClaim(id, [0, e("0.01")], HASH("claim"));
    await time.increase(91);
    await c.rental.finalizeAfterSilence(id);
    const d = await c.resolver.getDispute(1);
    expect(d.bond).to.equal(0);
    expect(d.bondPayer).to.equal(ethers.ZeroAddress);
  });

  it("only assigned arbiters vote, once each, within the disputed items", async () => {
    const c = await loadFixture(deployA2);
    await disputedRental(c, 0b100);
    const [x] = await panel(c, 1);
    await expect(c.resolver.connect(c.other).vote(1, 0, HASH("x"))).to.be.revertedWithCustomError(c.resolver, "NotAuthorized");
    await expect(c.resolver.connect(x).vote(1, 0b010, HASH("x"))).to.be.revertedWithCustomError(c.resolver, "BadInput");
    await c.resolver.connect(x).vote(1, 0, HASH("x"));
    await expect(c.resolver.connect(x).vote(1, 0, HASH("x"))).to.be.revertedWithCustomError(c.resolver, "BadStatus");
  });

  it("replaceArbiter works only after the deadline and only for slots that haven't voted", async () => {
    const c = await loadFixture(deployA2);
    await disputedRental(c, 0b100);
    const [x] = await panel(c, 1);
    await c.resolver.connect(x).vote(1, 0, HASH("x"));
    await expect(c.resolver.replaceArbiter(1, 1)).to.be.revertedWithCustomError(c.resolver, "WindowOpen");
    await time.increase(VOTING + 1);
    await expect(c.resolver.replaceArbiter(1, 0)).to.be.revertedWithCustomError(c.resolver, "BadStatus"); // slot 0 voted
    const before = (await c.resolver.getDispute(1)).arbiters;
    await expect(c.resolver.replaceArbiter(1, 1)).to.emit(c.resolver, "ArbiterReplaced");
    const after = (await c.resolver.getDispute(1)).arbiters;
    expect(after[1]).to.not.equal(before[1]);
    expect(new Set(after).size).to.equal(3);
    await expect(c.resolver.connect(c.other).replaceArbiter(1, 2))
      .to.be.revertedWithCustomError(c.resolver, "AccessControlUnauthorizedAccount");
  });

  it("only modules can open disputes, with the exact bond", async () => {
    const c = await loadFixture(deployA2);
    await expect(c.resolver.connect(c.other).openDispute(1, 0, c.tenant.address, c.landlord.address, 1, [1], ethers.ZeroAddress))
      .to.be.revertedWithCustomError(c.resolver, "NotAuthorized");
    const id = await c.rental.nextId();
    await c.rental.connect(c.landlord).offerLease(terms(c.tenant.address));
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await c.rental.connect(c.tenant).startMoveOut(id, HASH("out"));
    await c.rental.connect(c.landlord).submitClaim(id, [0, 1], HASH("c"));
    await expect(c.rental.connect(c.tenant).respond(id, 0b10, { value: BOND - 1n }))
      .to.be.revertedWithCustomError(c.rental, "BadAmount");
  });
});
