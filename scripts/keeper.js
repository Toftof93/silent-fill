// Clears every finished batch that has orders. Run it in a loop (cron, pm2, etc.).
//
//   AUCTION=0x... npx hardhat run scripts/keeper.js --network robinhoodTestnet
const { ethers } = require("hardhat");

const POLL_MS = 5_000;

async function main() {
  const auction = await ethers.getContractAt("SilentAuction", process.env.AUCTION);
  let next = BigInt(process.env.FROM_BATCH || (await auction.currentBatch()));
  console.log("Keeper watching from batch", next.toString());

  for (;;) {
    const current = await auction.currentBatch();
    while (next < current) {
      if (!(await auction.cleared(next)) && (await auction.orderCount(next)) > 0n) {
        try {
          const tx = await auction.clear(next);
          await tx.wait();
          console.log(`cleared batch ${next} @ price ${await auction.clearingPrice(next)}`);
        } catch (e) {
          console.error(`clear(${next}) failed:`, e.shortMessage || e.message);
          break; // retry next poll
        }
      }
      next++;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
