import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployCore, offer, Stat, HASH, RENT, DEPOSIT } from "./fixtures";

describe("NestRegistry + NestPassport", () => {
  it("register mints a soulbound passport; registering twice reverts", async () => {
    const { registry, passport, other } = await loadFixture(deployCore);
    await expect(registry.connect(other).register(1, HASH("profile")))
      .to.emit(registry, "Registered").withArgs(other.address, 1, HASH("profile"))
      .and.to.emit(passport, "PassportMinted").withArgs(other.address, BigInt(other.address));
    expect(await passport.hasPassport(other.address)).to.equal(true);
    expect(await passport.ownerOf(BigInt(other.address))).to.equal(other.address);
    await expect(registry.connect(other).register(1, HASH("again"))).to.be.revertedWithCustomError(registry, "BadStatus");
  });

  it("only a verifier can verify, and only registered users", async () => {
    const { registry, other, tenant } = await loadFixture(deployCore);
    await expect(registry.connect(tenant).verify(tenant.address))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(registry.verify(other.address)).to.be.revertedWithCustomError(registry, "BadInput");
  });

  it("passports cannot be transferred or approved", async () => {
    const { passport, tenant, other } = await loadFixture(deployCore);
    const id = BigInt(tenant.address);
    await expect(passport.connect(tenant).transferFrom(tenant.address, other.address, id))
      .to.be.revertedWithCustomError(passport, "NotAuthorized");
    await expect(passport.connect(tenant).approve(other.address, id)).to.be.revertedWithCustomError(passport, "NotAuthorized");
    await expect(passport.connect(tenant).setApprovalForAll(other.address, true))
      .to.be.revertedWithCustomError(passport, "NotAuthorized");
  });

  it("only modules can record stats", async () => {
    const { passport, other, tenant } = await loadFixture(deployCore);
    await expect(passport.connect(other).record(tenant.address, Stat.RentOnTime, 1))
      .to.be.revertedWithCustomError(passport, "NotAuthorized");
  });

  it("tenant tier goes 0 → 1 → 2 → 3 through real flows, and the deposit multiplier follows", async () => {
    const c = await loadFixture(deployCore);
    const { registry, passport, rental, tenant, landlord } = c;
    await registry.unverify(tenant.address);
    expect(await passport.tenantTier(tenant.address)).to.equal(0);
    await registry.verify(tenant.address);
    expect(await passport.tenantTier(tenant.address)).to.equal(1);
    expect(await passport.depositMultiplierBps(tenant.address)).to.equal(10000);

    const id = await offer(c);
    await rental.connect(tenant).signLease(id, { value: DEPOSIT });
    await rental.connect(tenant).payRent(id, { value: RENT });
    await rental.connect(tenant).payRent(id, { value: RENT });
    expect(await passport.statOf(tenant.address, Stat.RentOnTime)).to.equal(2);
    expect(await passport.tenantTier(tenant.address)).to.equal(2);
    expect(await passport.depositMultiplierBps(tenant.address)).to.equal(7500);

    await rental.connect(tenant).startMoveOut(id, HASH("out"));
    await rental.connect(landlord).releaseDepositInFull(id);
    expect(await passport.tenantTier(tenant.address)).to.equal(3);
    expect(await passport.depositMultiplierBps(tenant.address)).to.equal(5000);
    expect(await rental.requiredDeposit(tenant.address, RENT, 6)).to.equal(RENT * 6n / 2n);
    // 500 verified + 2×10 on-time rent + 1×50 completed lease
    expect(await passport.trustScore(tenant.address)).to.equal(570);
  });

  it("reputation is not recorded when the counterparty is unverified (N11)", async () => {
    const c = await loadFixture(deployCore);
    await c.registry.unverify(c.landlord.address);
    const id = await offer(c);
    await c.rental.connect(c.tenant).signLease(id, { value: DEPOSIT });
    await c.rental.connect(c.tenant).payRent(id, { value: RENT });
    expect(await c.passport.statOf(c.tenant.address, Stat.RentOnTime)).to.equal(0);
  });

  it("tokenURI points at the passport page (P1)", async () => {
    const { passport, tenant } = await loadFixture(deployCore);
    await passport.setBaseURI("https://nestledger.app/passport/");
    expect(await passport.tokenURI(BigInt(tenant.address)))
      .to.equal("https://nestledger.app/passport/" + tenant.address.toLowerCase());
    await expect(passport.connect(tenant).setBaseURI("x")).to.be.revertedWithCustomError(passport, "NotAuthorized");
    expect(ethers.isAddress(await passport.admin())).to.equal(true);
  });
});
