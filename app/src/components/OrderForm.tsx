"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { encodeAbiParameters, formatUnits, keccak256, parseEventLogs, parseUnits, toHex } from "viem";
import { auctionAbi } from "@/lib/abi";
import { batchClock, fmt, fromRawPrice, toRawPrice, type Market } from "@/lib/market";
import { useBalances, useTx } from "@/lib/hooks";
import type { SavedOrder } from "@/lib/orders";

/** Don't let a commit go out this close to the end of Whisper; it might land too late. */
const SAFETY_SECONDS = 8;

export function OrderForm({ m, now, onCommitted }: {
  m: Market;
  now: number;
  onCommitted: {
    add: (o: SavedOrder) => void;
    patch: (salt: string, p: Partial<SavedOrder>) => void;
  };
}) {
  const { address } = useAccount();
  const chainId = useChainId();
  const b = useBalances(m);
  const tx = useTx();
  const { batchId, phase, secondsLeft } = batchClock(m, now);

  const [isBuy, setIsBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [limit, setLimit] = useState("");

  // Prefill a limit 2% through the oracle so the order is likely to fill.
  const oracleHuman = m.oraclePrice ? fromRawPrice(m, m.oraclePrice) : undefined;
  useEffect(() => {
    if (!oracleHuman || limit) return;
    const px = Number(oracleHuman) * (isBuy ? 1.02 : 0.98);
    setLimit(px.toFixed(2));
  }, [oracleHuman]); // eslint-disable-line react-hooks/exhaustive-deps

  const flipSide = (buy: boolean) => {
    setIsBuy(buy);
    if (oracleHuman) setLimit((Number(oracleHuman) * (buy ? 1.02 : 0.98)).toFixed(2));
  };

  let rawAmount = 0n;
  let rawLimit = 0n;
  try {
    rawAmount = amount ? parseUnits(amount, m.baseDecimals) : 0n;
    rawLimit = limit ? toRawPrice(m, limit) : 0n;
  } catch {}

  // What will be locked at Unseal (mirrors the contract).
  const ceilDiv = (a: bigint, d: bigint) => (a + d - 1n) / d;
  const maxCost = ceilDiv(rawAmount * rawLimit, 10n ** 18n);
  const needed = isBuy ? maxCost + ceilDiv(maxCost * m.feeBps, 10_000n) : rawAmount;
  // The bond is released at Unseal right before the order is locked, so the whole free balance counts.
  const availableForOrder = isBuy ? b.available.quote : b.available.base;
  const notEnoughFunds = rawAmount > 0n && needed > availableForOrder;
  const notEnoughBond = b.loaded && b.available.quote < m.bond;

  const tooLate = phase !== "whisper" || secondsLeft <= SAFETY_SECONDS;
  const canSubmit = !!address && !tx.busy && !tooLate && rawAmount > 0n && rawLimit > 0n && !notEnoughFunds && !notEnoughBond;

  const submit = async () => {
    const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
    const commitment = keccak256(
      encodeAbiParameters(
        [
          { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "uint256" },
          { type: "bool" }, { type: "uint128" }, { type: "uint128" }, { type: "bytes32" },
        ],
        [BigInt(chainId), m.auction, address!, batchId, isBuy, rawAmount, rawLimit, salt],
      ),
    );

    // Save the secret before sending anything, so a closed tab can't lose it.
    onCommitted.add({
      salt,
      batchId: batchId.toString(),
      isBuy,
      amount: rawAmount.toString(),
      limitPrice: rawLimit.toString(),
      status: "pending",
      createdAt: Date.now(),
    });

    const receipt = await tx.run("Whisper", [
      (w) => w({ address: m.auction, abi: auctionAbi, functionName: "commit", args: [batchId, commitment] }),
    ]);
    if (!receipt) {
      onCommitted.patch(salt, { status: "commit-failed" });
      return;
    }
    const [ev] = parseEventLogs({ abi: auctionAbi, eventName: "Committed", logs: receipt.logs });
    onCommitted.patch(salt, {
      status: "committed",
      index: ev.args.index.toString(),
      commitBlock: receipt.blockNumber.toString(),
    });
    tx.setMsg({ text: "Sealed 🤫 It will be revealed automatically while this tab stays open." });
    setAmount("");
    b.refetch();
  };

  return (
    <section className="panel">
      <h2>Whisper an order</h2>
      <div className="stack" style={{ gap: 12 }}>
        <div className="seg">
          <button className={isBuy ? "on-buy" : ""} onClick={() => flipSide(true)}>Buy {m.baseSymbol}</button>
          <button className={!isBuy ? "on-sell" : ""} onClick={() => flipSide(false)}>Sell {m.baseSymbol}</button>
        </div>

        <div className="field">
          <label>
            <span>Amount</span>
            <span className="mono">
              {isBuy ? "" : `available ${fmt(formatUnits(b.available.base, m.baseDecimals))}`}
            </span>
          </label>
          <div className="input-row">
            <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="unit">{m.baseSymbol}</span>
          </div>
        </div>

        <div className="field">
          <label>
            <span>{isBuy ? "Max price" : "Min price"} (limit)</span>
            {oracleHuman && <span className="mono">oracle ${fmt(oracleHuman, 2)}</span>}
          </label>
          <div className="input-row">
            <input inputMode="decimal" placeholder="0.00" value={limit} onChange={(e) => setLimit(e.target.value)} />
            <span className="unit">{m.quoteSymbol}</span>
          </div>
        </div>

        <div>
          <div className="kv">
            <span>Locked at Unseal</span>
            <b>
              {fmt(formatUnits(needed, isBuy ? m.quoteDecimals : m.baseDecimals))} {isBuy ? m.quoteSymbol : m.baseSymbol}
            </b>
          </div>
          <div className="kv">
            <span>Bond (returned when you reveal)</span>
            <b>{fmt(formatUnits(m.bond, m.quoteDecimals))} {m.quoteSymbol}</b>
          </div>
          <div className="kv">
            <span>Fee</span>
            <b>{(Number(m.feeBps) / 100).toFixed(2)}%</b>
          </div>
          <div className="kv">
            <span>You fill at</span>
            <b>the oracle midpoint, if it’s within your limit</b>
          </div>
        </div>

        {notEnoughBond && <div className="notice warn">Deposit at least {fmt(formatUnits(m.bond, m.quoteDecimals))} {m.quoteSymbol} into the vault to cover the bond.</div>}
        {notEnoughFunds && <div className="notice warn">Not enough free balance in the vault for this order.</div>}

        <button className="btn btn-primary btn-block" disabled={!canSubmit} onClick={submit}>
          {!address
            ? "Connect wallet"
            : phase !== "whisper"
              ? `Next Whisper in ${secondsLeft}s`
              : tooLate
                ? "Too close to Unseal, wait for the next batch"
                : `Whisper ${isBuy ? "buy" : "sell"} 🤫`}
        </button>
      </div>
      {tx.msg && <div className={`status ${tx.msg.error ? "err" : "muted"}`}>{tx.msg.text}</div>}
    </section>
  );
}
