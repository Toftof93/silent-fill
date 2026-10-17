// Deploys Silent Fill. If BASE_TOKEN / QUOTE_TOKEN / PRICE_FEED are not set, it deploys
// mock WETH, mock USDC and a mock ETH/USD feed so you can play on testnet right away.
//
//   npx hardhat run scripts/deploy.js --network robinhoodTestnet
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const DEPLOYMENTS = path.join(__dirname, "..", "app", "src", "deployments.json");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const env = process.env;
  const commitSecs = Number(env.COMMIT_SECONDS || 60);
  const revealSecs = Number(env.REVEAL_SECONDS || 30);
  const feeTo = env.FEE_RECIPIENT || deployer.address;

  let base = env.BASE_TOKEN;
  let quote = env.QUOTE_TOKEN;
  let feed = env.PRICE_FEED;
  // The mock feed never updates by itself, so don't let it go stale on testnet.
  let maxStaleness = Number(env.MAX_STALENESS || 3600);

  if (!base || !quote || !feed) {
    console.log("No token/feed addresses set: deploying mocks");
    const Token = await ethers.getContractFactory("MockERC20");
    base = await (await Token.deploy("Silent WETH", "sWETH", 18)).getAddress();
    quote = await (await Token.deploy("Silent USDC", "sUSDC", 6)).getAddress();
    const Feed = await ethers.getContractFactory("MockAggregator");
    feed = await (await Feed.deploy(8, 3000n * 10n ** 8n)).getAddress();
    if (!env.MAX_STALENESS) maxStaleness = 365 * 24 * 3600;
  }

  const baseDec = await (await ethers.getContractAt("MockERC20", base)).decimals();
  const quoteDec = await (await ethers.getContractAt("MockERC20", quote)).decimals();
  const bond = ethers.parseUnits(env.BOND || "10", quoteDec);

  const oracle = await (await ethers.getContractFactory("SilentOracle")).deploy(
    feed, maxStaleness, baseDec, quoteDec
  );
  const vault = await (await ethers.getContractFactory("SilentVault")).deploy(deployer.address);
  const auction = await (await ethers.getContractFactory("SilentAuction")).deploy(
    deployer.address, vault, base, quote, oracle, feeTo, commitSecs, revealSecs, bond
  );
  await (await vault.setAuction(auction, true)).wait();

  const out = {
    base,
    quote,
    feed,
    oracle: await oracle.getAddress(),
    vault: await vault.getAddress(),
    auction: await auction.getAddress(),
  };
  console.log(out);

  // Save for the web app, keyed by chain id.
  const chainId = String(network.config.chainId || (await ethers.provider.getNetwork()).chainId);
  const all = fs.existsSync(DEPLOYMENTS) ? JSON.parse(fs.readFileSync(DEPLOYMENTS, "utf8")) : {};
  all[chainId] = out;
  fs.mkdirSync(path.dirname(DEPLOYMENTS), { recursive: true });
  fs.writeFileSync(DEPLOYMENTS, JSON.stringify(all, null, 2) + "\n");
  console.log(`Saved to app/src/deployments.json under chain ${chainId}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
