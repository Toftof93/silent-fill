# Silent Fill

**Filled. Not seen.** · Live on Robinhood Chain testnet: **https://silentfill.xyz** A sealed-bid, batch-auction dark pool for Robinhood Chain.

Orders are hidden until trading closes for the batch, then every match fills at one oracle midpoint price. Nobody can see an order and jump ahead of it, there's no sandwiching, and there's no AMM price impact.

## How a batch works

| Phase | Name | What happens |
|---|---|---|
| 1 | **Whisper** (commit, 60s default) | Trader posts `hash(order, salt)` and a flat bond is locked. Side and size stay hidden. |
| 2 | **Unseal** (reveal, 30s default) | Trader reveals the order and its funds get locked. No new orders can enter. |
| 3 | **The Fill** (clear) | Anyone (the keeper) calls `clear(batchId)`. Eligible buys (`limit >= price`) and sells (`limit <= price`) are matched at the oracle price. The larger side is filled pro-rata. |

- A trader who commits but doesn't reveal **loses the bond**. This stops people from committing just to keep a free option to trade.
- If the oracle is stale or broken at clear time, the batch is **cancelled** and all funds unlock. Funds are never trapped.
- Fees (max 1%) are charged on the quote side to both buyer and seller. Fees, rounding dust and slashed bonds go to `feeRecipient`.

## Contracts

| Contract | Role |
|---|---|
| `SilentVault` | Holds user funds (deposit and withdraw). The auction can lock and settle balances. Optional per-token deposit caps for launch. |
| `SilentAuction` | One BASE/QUOTE market: commit, reveal and clear. Max 100 orders per batch to keep `clear` gas bounded. |
| `SilentOracle` | Chainlink-style adapter (BASE/USD feed to a raw base-to-quote price) with a staleness check. |

## Web app

`app/` is a Next.js + wagmi front end. With it you can connect a wallet, deposit, Whisper a sealed order, have it **auto-unsealed** while the tab is open, settle a batch, and see your fills.

Try it locally (3 terminals):

```bash
npm run node                                   # 1. local chain
COMMIT_SECONDS=40 REVEAL_SECONDS=25 npm run deploy:local   # 2. deploy (writes app/src/deployments.json)
cd app && npm install && npm run dev           # 3. http://localhost:3000
```

In MetaMask, add the network `http://127.0.0.1:8545` (chain id 31337) and import one of the test private keys that `npm run node` prints. Then use the **Testnet faucet** button.

**Deploy from a phone wallet:** open `/deploy` in your wallet app's browser, tap Deploy and approve 7 transactions. Then put the addresses it shows into `app/src/deployments.json`.

Deploying to Robinhood Chain testnet with `npm run deploy:testnet` also writes the addresses into `app/src/deployments.json`, so the app picks them up automatically.

> The secret (salt) needed to reveal an order is stored in your browser's localStorage. Keep the tab open until Unseal, or you lose the bond.

After changing contracts, run `npm run abi` to refresh the app's ABIs.

## Quick start (contracts)

```bash
npm install
npm test                       # 11 tests
cp .env.example .env           # add PRIVATE_KEY (a testnet-only key)
npm run deploy:testnet         # Robinhood Chain testnet (chain 46630)
AUCTION=0x... npm run keeper:testnet
```

If `BASE_TOKEN`, `QUOTE_TOKEN` and `PRICE_FEED` aren't set, the deploy script creates mock sWETH, sUSDC and an ETH/USD feed. Anyone can call `mint` on the mocks to get test tokens.

The project compiles with the npm `solc` build (see `hardhat.config.js`), so it doesn't need to download a compiler.

## Known limitations (fix before mainnet)

1. **Deposits are public.** Vault balances show what each user *could* trade. Future fixes: fixed-size deposits or shielded deposits.
2. **Revealed orders are visible for about 30s before clearing.** No new orders can join, but the information is public. A future TEE matcher would remove the reveal step entirely.
3. **Oracle risk.** Use a deep-liquidity feed. Consider a TWAP or Pyth, plus a deviation check against a second source.
4. **The quote token is assumed to be a USD stablecoin** by `SilentOracle`.
5. **Unmatched size isn't routed anywhere.** It just unlocks. Fallback to an AMM, or incentives for market makers, is on the roadmap.
6. **No audit yet.** Do not put real money in this until it's audited.
