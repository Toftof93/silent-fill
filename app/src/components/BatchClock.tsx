"use client";

import { useAccount, useReadContracts } from "wagmi";
import { auctionAbi } from "@/lib/abi";
import { batchClock, fmt, fromRawPrice, type Market } from "@/lib/market";
import { useTx } from "@/lib/hooks";

export function BatchClock({ m, now }: { m: Market; now: number }) {
  const { isConnected } = useAccount();
  const { batchId, phase, secondsLeft, period } = batchClock(m, now);
  const prev = batchId > 0n ? batchId - 1n : undefined;
  const prevId = prev ?? 0n;
  const tx = useTx();

  const { data, refetch } = useReadContracts({
    query: { refetchInterval: 4_000 },
    contracts: [
      { address: m.auction, abi: auctionAbi, functionName: "orderCount", args: [batchId] },
      { address: m.auction, abi: auctionAbi, functionName: "orderCount", args: [prevId] },
      { address: m.auction, abi: auctionAbi, functionName: "cleared", args: [prevId] },
      { address: m.auction, abi: auctionAbi, functionName: "clearingPrice", args: [prevId] },
    ],
  });
  const ordersNow = data?.[0]?.result as bigint | undefined;
  const prevOrders = data?.[1]?.result as bigint | undefined;
  const prevCleared = data?.[2]?.result as boolean | undefined;
  const prevPrice = prev !== undefined ? (data?.[3]?.result as bigint | undefined) : undefined;
  const needsSettle = prev !== undefined && prevCleared === false && (prevOrders ?? 0n) > 0n;

  const elapsed = phase === "whisper" ? m.commitDuration - secondsLeft : period - secondsLeft;
  const whisperPct = (Math.min(elapsed, m.commitDuration) / period) * 100;
  const unsealPct = (Math.max(0, elapsed - m.commitDuration) / period) * 100;

  const settle = async () => {
    await tx.run(`Settling batch #${prev}`, [
      (w) => w({ address: m.auction, abi: auctionAbi, functionName: "clear", args: [prev!] }),
    ]);
    refetch();
  };

  return (
    <section className="panel clock">
      <div className="clock-top">
        <div>
          <div className="muted small mono">BATCH #{batchId.toString()}</div>
          <div className={`phase-name ${phase}`}>{phase === "whisper" ? "Whisper" : "Unseal"}</div>
          <div className="phase-sub">
            {phase === "whisper"
              ? "Sealed orders are open. Nobody can see side, size or price."
              : "Orders are being revealed. No new orders until the next batch."}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="countdown">{secondsLeft}s</div>
          <div className="muted small">{phase === "whisper" ? "until Unseal" : "until The Fill"}</div>
        </div>
      </div>

      <div className="bar" aria-hidden key={batchId.toString()}>
        <div style={{ width: `${whisperPct}%`, background: "var(--violet)" }} />
        <div style={{ width: `${unsealPct}%`, background: "var(--mint)" }} />
      </div>

      <div className="steps">
        <div className={`step ${phase === "whisper" ? "active" : ""}`}>
          <b>1 · Whisper</b>Post a sealed order
        </div>
        <div className={`step ${phase === "unseal" ? "active" : ""}`}>
          <b>2 · Unseal</b>Reveal it (automatic)
        </div>
        <div className="step">
          <b>3 · The Fill</b>Everyone fills at one price
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="label">Oracle price</div>
          <div className="value">{m.oraclePrice ? `$${fmt(fromRawPrice(m, m.oraclePrice), 2)}` : "—"}</div>
        </div>
        <div className="stat">
          <div className="label">Last fill price</div>
          <div className="value">{prevPrice ? `$${fmt(fromRawPrice(m, prevPrice), 2)}` : "—"}</div>
        </div>
        <div className="stat">
          <div className="label">Orders this batch</div>
          <div className="value">{ordersNow?.toString() ?? "—"}</div>
        </div>
        <div className="stat">
          <div className="label">Snipers fed</div>
          <div className="value mint">0</div>
        </div>
      </div>

      {needsSettle && (
        <div className="notice" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Batch #{prev!.toString()} is waiting to be settled. Anyone can trigger The Fill.</span>
          <button className="btn btn-sm btn-primary" disabled={!isConnected || tx.busy} onClick={settle}>
            Settle
          </button>
        </div>
      )}
      {tx.msg && <div className={`status ${tx.msg.error ? "err" : "muted"}`}>{tx.msg.text}</div>}
    </section>
  );
}
