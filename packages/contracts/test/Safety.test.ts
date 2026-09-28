import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { DEPOSIT, deployCore, HASH, offer, RENT, terms, toMoveOut, W } from "./fixtures";

describe("Safety (SPEC §5.1, §5.11)", () => {
  it("pausing blocks new offers but not signing, claims, finalisations or exits", async () => {
    const c = await loadFixture(deployCore);
    const id = await offer(c);
    await c.rental.pause();
    await expect(c.rental.connect(c.landlord).offerLease(terms(c.tenant.address)))
      .to.be.revertedWithCustomError(c.rental, "EnforcedPause");
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    await c.rental.connect(c.tenant).startMoveOut(id, HASH("out"));
    await time.increase(W.claimWindow + 1);
    await expect(c.rental.finalizeNoClaim(id)).to.changeEtherBalance(c.tenant, DEPOSIT);
  });

  it("a recipient that rejects payments lands in withdrawable, and cannot withdraw twice by re-entering", async () => {
    const c = await loadFixture(deployCore);
    const { registry, rental, tenant } = c;
    const actor = await (await ethers.getContractFactory("Actor")).deploy();
    const actorAddr = await actor.getAddress();
    await actor.exec(await registry.getAddress(), registry.interface.encodeFunctionData("register", [2, ethers.ZeroHash]));
    await registry.verify(actorAddr);
    await actor.setRejectPayments(true);

    const id = await rental.nextId();
    await actor.exec(await rental.getAddress(), rental.interface.encodeFunctionData("offerLease", [terms(tenant.address)]));
    await rental.connect(tenant).signLease(id, { value: DEPOSIT });
    await expect(rental.connect(tenant).payRent(id, { value: RENT }))
      .to.emit(rental, "PayoutDeferred").withArgs(actorAddr, RENT);
    expect(await rental.withdrawable(actorAddr)).to.equal(RENT);

    await actor.setRejectPayments(false);
    await actor.setReenter(await rental.getAddress());
    const withdraw = rental.interface.encodeFunctionData("withdraw");
    await expect(actor.exec(await rental.getAddress(), withdraw)).to.changeEtherBalances([actor, rental], [RENT, -RENT]);
    expect(await actor.reentries()).to.equal(1);
    expect(await rental.withdrawable(actorAddr)).to.equal(0);
    expect(await ethers.provider.getBalance(await rental.getAddress())).to.equal(DEPOSIT); // deposit untouched
  });

  it("no role can take escrowed money: the only admin functions are pause and role management", async () => {
    const c = await loadFixture(deployCore);
    await toMoveOut(c);
    await expect(c.rental.connect(c.admin).withdraw()).to.be.revertedWithCustomError(c.rental, "BadAmount");

    const writes = c.rental.interface.fragments
      .filter((f) => f.type === "function" && !(f as any).constant && (f as any).stateMutability !== "view" && (f as any).stateMutability !== "pure")
      .map((f) => (f as any).name)
      .sort();
    expect(writes).to.deep.equal([
      "attest", "cancelOffer", "confirmBaseline", "contestBaseline", "finalizeAfterSilence", "finalizeBaseline",
      "finalizeNoClaim", "grantRole", "offerLease", "onDisputeResolved", "pause", "payRent", "releaseDepositInFull",
      "renounceRole", "respond", "revokeRole", "signLease", "startMoveOut", "submitBaseline", "submitClaim",
      "unpause", "withdraw",
    ]);
    // onDisputeResolved is callable only by the resolver.
    await expect(c.rental.connect(c.admin).onDisputeResolved(1, 0)).to.be.revertedWithCustomError(c.rental, "NotAuthorized");
  });
});
