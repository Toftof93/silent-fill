const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ETH = (n) => ethers.parseUnits(String(n), 18);
const USDC = (n) => ethers.parseUnits(String(n), 6);
// price scale: raw quote per 1e18 raw base. 1 ETH = 3000 USDC -> 3000e6
const PX = (usd) => USDC(usd);

const COMMIT = 60;
const REVEAL = 30;
const BOND = USDC(10);

async function deploy() {
  const [owner, feeTo, alice, bob, carol, dave] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockERC20");
  const weth = await Token.deploy("Wrapped Ether", "WETH", 18);
  const usdc = await Token.deploy("USD Coin", "USDC", 6);

  const feed = await (await ethers.getContractFactory("MockAggregator")).deploy(8, 3000n * 10n ** 8n);
  const oracle = await (await ethers.getContractFactory("SilentOracle")).deploy(feed, 3600, 18, 6);

  const vault = await (await ethers.getContractFactory("SilentVault")).deploy(owner);
  const auction = await (await ethers.getContractFactory("SilentAuction")).deploy(
    owner, vault, weth, usdc, oracle, feeTo, COMMIT, REVEAL, BOND
  );
  await vault.setAuction(auction, true);

  for (const u of [alice, bob, carol, dave]) {
    await weth.mint(u, ETH(100));
    await usdc.mint(u, USDC(1_000_000));
    await weth.connect(u).approve(vault, ethers.MaxUint256);
    await usdc.connect(u).approve(vault, ethers.MaxUint256);
    await vault.connect(u).deposit(weth, ETH(100));
    await vault.connect(u).deposit(usdc, USDC(1_000_000));
  }

  return { owner, feeTo, alice, bob, carol, dave, weth, usdc, feed, oracle, vault, auction };
}

async function commitOrder(auction, signer, isBuy, amount, limitPrice) {
  const batchId = await auction.currentBatch();
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const c = await auction.computeCommitment(signer.address, batchId, isBuy, amount, limitPrice, salt);
  const index = await auction.orderCount(batchId);
  await auction.connect(signer).commit(batchId, c);
  return { signer, batchId, index, isBuy, amount, limitPrice, salt };
}

async function reveal(auction, o) {
  return auction.connect(o.signer).reveal(o.batchId, o.index, o.isBuy, o.amount, o.limitPrice, o.salt);
}

async function toReveal(auction, batchId) {
  await time.increaseTo(await auction.revealStart(batchId));
}

async function toEnd(auction, batchId) {
  await time.increaseTo(await auction.batchEnd(batchId));
}

async function freshBatch(auction) {
  // start at the beginning of the next batch so there's a full commit window
  await time.increaseTo(await auction.batchStart((await auction.currentBatch()) + 1n));
  return auction.currentBatch();
}

describe("SilentOracle", () => {
  it("converts a USD feed into raw base->quote price", async () => {
    const { oracle } = await loadFixture(deploy);
    expect(await oracle.price()).to.equal(PX(3000));
  });

  it("reverts on stale price", async () => {
    const { oracle, feed } = await loadFixture(deploy);
    await feed.setUpdatedAt((await time.latest()) - 4000);
    await expect(oracle.price()).to.be.revertedWithCustomError(oracle, "StalePrice");
  });
});

describe("SilentAuction", () => {
  it("fully matches one buy against one sell at the oracle midpoint", async () => {
    const { auction, vault, weth, usdc, alice, bob } = await loadFixture(deploy);
    const id = await freshBatch(auction);

    const buy = await commitOrder(auction, alice, true, ETH(1), PX(3100));
    const sell = await commitOrder(auction, bob, false, ETH(1), PX(2900));
    await toReveal(auction, id);
    await reveal(auction, buy);
    await reveal(auction, sell);
    await toEnd(auction, id);
    await auction.clear(id);

    expect(await vault.balanceOf(alice, weth)).to.equal(ETH(101));
    expect(await vault.balanceOf(alice, usdc)).to.equal(USDC(1_000_000 - 3000));
    expect(await vault.balanceOf(bob, weth)).to.equal(ETH(99));
    expect(await vault.balanceOf(bob, usdc)).to.equal(USDC(1_000_000 + 3000));
    expect(await vault.lockedOf(alice, usdc)).to.equal(0);
    expect(await vault.lockedOf(bob, weth)).to.equal(0);
    expect(await auction.clearingPrice(id)).to.equal(PX(3000));
  });

  it("fills the larger side pro-rata", async () => {
    const { auction, vault, weth, alice, bob, carol } = await loadFixture(deploy);
    const id = await freshBatch(auction);

    const b1 = await commitOrder(auction, alice, true, ETH(1), PX(3100));
    const b2 = await commitOrder(auction, bob, true, ETH(2), PX(3100));
    const s1 = await commitOrder(auction, carol, false, ETH("1.5"), PX(2900));
    await toReveal(auction, id);
    for (const o of [b1, b2, s1]) await reveal(auction, o);
    await toEnd(auction, id);
    await auction.clear(id);

    expect(await vault.balanceOf(alice, weth)).to.equal(ETH("100.5"));
    expect(await vault.balanceOf(bob, weth)).to.equal(ETH(101));
    expect(await vault.balanceOf(carol, weth)).to.equal(ETH("98.5"));
  });

  it("skips orders whose limit is not met and unlocks their funds", async () => {
    const { auction, vault, weth, usdc, alice, bob } = await loadFixture(deploy);
    const id = await freshBatch(auction);

    const buy = await commitOrder(auction, alice, true, ETH(1), PX(2500)); // below 3000
    const sell = await commitOrder(auction, bob, false, ETH(1), PX(2900));
    await toReveal(auction, id);
    await reveal(auction, buy);
    await reveal(auction, sell);
    expect(await vault.lockedOf(alice, usdc)).to.equal(USDC(2500));
    await toEnd(auction, id);
    await auction.clear(id);

    expect(await vault.balanceOf(alice, usdc)).to.equal(USDC(1_000_000));
    expect(await vault.balanceOf(bob, weth)).to.equal(ETH(100));
    expect(await vault.lockedOf(alice, usdc)).to.equal(0);
    expect(await vault.lockedOf(bob, weth)).to.equal(0);
  });

  it("slashes the bond of anyone who commits but never reveals", async () => {
    const { auction, vault, usdc, alice, feeTo } = await loadFixture(deploy);
    const id = await freshBatch(auction);

    await commitOrder(auction, alice, true, ETH(1), PX(3100));
    expect(await vault.lockedOf(alice, usdc)).to.equal(BOND);
    await toEnd(auction, id);
    await auction.clear(id);

    expect(await vault.balanceOf(alice, usdc)).to.equal(USDC(1_000_000) - BOND);
    expect(await vault.balanceOf(feeTo, usdc)).to.equal(BOND);
  });

  it("charges fees on both sides and sends them to the fee recipient", async () => {
    const { auction, vault, oracle, weth, usdc, alice, bob, feeTo } = await loadFixture(deploy);
    await auction.setParams(oracle, feeTo, 30, BOND); // 0.30%
    const id = await freshBatch(auction);

    const buy = await commitOrder(auction, alice, true, ETH(1), PX(3100));
    const sell = await commitOrder(auction, bob, false, ETH(1), PX(2900));
    await toReveal(auction, id);
    await reveal(auction, buy);
    await reveal(auction, sell);
    await toEnd(auction, id);
    await auction.clear(id);

    expect(await vault.balanceOf(alice, usdc)).to.equal(USDC(1_000_000 - 3009));
    expect(await vault.balanceOf(bob, usdc)).to.equal(USDC(1_000_000 + 2991));
    expect(await vault.balanceOf(feeTo, usdc)).to.equal(USDC(18));
    expect(await vault.balanceOf(alice, weth)).to.equal(ETH(101));
  });

  it("cancels the batch instead of trapping funds when the oracle is stale", async () => {
    const { auction, vault, feed, weth, usdc, alice, bob } = await loadFixture(deploy);
    const id = await freshBatch(auction);

    const buy = await commitOrder(auction, alice, true, ETH(1), PX(3100));
    const sell = await commitOrder(auction, bob, false, ETH(1), PX(2900));
    await toReveal(auction, id);
    await reveal(auction, buy);
    await reveal(auction, sell);
    await toEnd(auction, id);
    await feed.setUpdatedAt(1);
    await expect(auction.clear(id)).to.emit(auction, "BatchCleared").withArgs(id, 0, 0, true);

    expect(await vault.lockedOf(alice, usdc)).to.equal(0);
    expect(await vault.lockedOf(bob, weth)).to.equal(0);
    expect(await vault.balanceOf(alice, weth)).to.equal(ETH(100));
  });

  it("enforces phases and commitments", async () => {
    const { auction, alice, bob } = await loadFixture(deploy);
    const id = await freshBatch(auction);
    const o = await commitOrder(auction, alice, true, ETH(1), PX(3100));

    await expect(reveal(auction, o)).to.be.revertedWithCustomError(auction, "NotRevealPhase");
    await toReveal(auction, id);
    await expect(auction.connect(alice).commit(id, ethers.ZeroHash)).to.be.revertedWithCustomError(auction, "NotCommitPhase");
    await expect(auction.connect(alice).commit(id + 1n, ethers.ZeroHash)).to.be.revertedWithCustomError(auction, "NotCommitPhase");
    await expect(reveal(auction, { ...o, amount: ETH(2) })).to.be.revertedWithCustomError(auction, "BadReveal");
    await expect(reveal(auction, { ...o, signer: bob })).to.be.revertedWithCustomError(auction, "NotYourOrder");
    await expect(auction.clear(id)).to.be.revertedWithCustomError(auction, "BatchNotOver");
    await reveal(auction, o);
    await expect(reveal(auction, o)).to.be.revertedWithCustomError(auction, "AlreadyRevealed");
    await toEnd(auction, id);
    await auction.clear(id);
    await expect(auction.clear(id)).to.be.revertedWithCustomError(auction, "AlreadyCleared");
  });

  it("does not let users withdraw locked funds", async () => {
    const { auction, vault, weth, bob } = await loadFixture(deploy);
    const id = await freshBatch(auction);
    const sell = await commitOrder(auction, bob, false, ETH(100), PX(2900));
    await toReveal(auction, id);
    await reveal(auction, sell);
    await expect(vault.connect(bob).withdraw(weth, 1)).to.be.revertedWithCustomError(vault, "InsufficientAvailable");
  });

  it("conserves every token across a messy batch", async () => {
    const { auction, vault, oracle, weth, usdc, alice, bob, carol, dave, feeTo } = await loadFixture(deploy);
    await auction.setParams(oracle, feeTo, 25, BOND);
    const id = await freshBatch(auction);

    // odd sizes to force rounding
    const orders = [
      await commitOrder(auction, alice, true, 1234567890123456789n, PX(3050)),
      await commitOrder(auction, bob, true, 777777777777777777n, PX(3001)),
      await commitOrder(auction, carol, false, 333333333333333333n, PX(2999)),
      await commitOrder(auction, dave, false, 999999999999999999n, PX(2000)),
      await commitOrder(auction, alice, false, 5n, PX(3500)), // not eligible
      await commitOrder(auction, bob, true, ETH(1), PX(3000)), // never revealed
    ];
    await toReveal(auction, id);
    for (const o of orders.slice(0, 5)) await reveal(auction, o);
    await toEnd(auction, id);
    await auction.clear(id);

    const users = [alice, bob, carol, dave, feeTo, auction];
    for (const token of [weth, usdc]) {
      let sum = 0n;
      for (const u of users) {
        sum += await vault.balanceOf(u, token);
        expect(await vault.lockedOf(u, token)).to.equal(0);
      }
      expect(sum).to.equal(await token.balanceOf(vault));
    }
    // the matched size moved from sellers to buyers exactly
    const sold = ETH(100) * 2n - (await vault.balanceOf(carol, weth)) - (await vault.balanceOf(dave, weth));
    expect(sold).to.equal(333333333333333333n + 999999999999999999n);
    expect(await vault.balanceOf(auction, weth)).to.equal(0);
  });
});
