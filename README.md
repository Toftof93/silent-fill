# Silent Fill

**Filled. Not seen.** A sealed-bid, batch-auction dark pool for Robinhood Chain.

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

## Quick start

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
