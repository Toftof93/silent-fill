"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContracts } from "wagmi";
import { formatUnits, type Address } from "viem";
import { auctionAbi } from "@/lib/abi";
import { batchClock, fmt, fromRawPrice, type Market } from "@/lib/market";
import { useTx } from "@/lib/hooks";
import type { SavedOrder } from "@/lib/orders";

type Store = {
  orders: SavedOrder[];
  patch: (salt: string, p: Partial<SavedOrder>) => void;
  remove: (salt: string) => void;
};

export function MyOrders({ m, now, store }: { m: Market; now: number; store: Store }) {
  const { address } = useAccount();
  const { batchId, phase, secondsLeft } = batchClock(m, now);
  const tx = useTx();
  const [autoReveal, setAutoReveal] = useState(true);
  const attempted = useRef(new Set<string>());

  const reveal = async (o: SavedOrder) => {
    attempted.current.add(o.salt);
    const ok = await tx.run(`Unseal batch #${o.batchId}`, [
      (w) =>
        w({
          address: m.auction,
          abi: auctionAbi,
          functionName: "reveal",
          args: [BigInt(o.batchId), BigInt(o.index!), o.isBuy, BigInt(o.amount), BigInt(o.limitPrice), o.salt],
        }),
    ]);
    if (ok) store.patch(o.salt, { status: "revealed" });
  };

  // Auto-reveal: during Unseal, reveal this batch's sealed orders one at a time.
  const due = store.orders.filter(
    (o) => o.status === "committed" && o.index !== undefined && BigInt(o.batchId) === batchId && phase === "unseal",
  );
  // Auto-settle: once a batch we have orders in is over, trigger The Fill if nobody has yet.
  const endedBatches = [
    ...new Set(
      store.orders
        .filter((o) => (o.status === "revealed" || o.status === "committed") && BigInt(o.batchId) < batchId)
        .map((o) => o.batchId),
    ),
  ].slice(0, 5);
  const { data: clearedData, refetch: refetchCleared } = useReadContracts({
    query: { enabled: endedBatches.length > 0, refetchInterval: 5_000 },
    contracts: endedBatches.map((b) => ({
      address: m.auction,
      abi: auctionAbi,
      functionName: "cleared" as const,
      args: [BigInt(b)] as const,
    })),
  });
  const unsettled = endedBatches.filter((_, i) => clearedData?.[i]?.status === "success" && clearedData[i].result === false);

  const client = usePublicClient();
  const settle = async (b: string) => {
    attempted.current.add(`settle:${b}`);
    // Someone else (another trader's tab, a keeper) may have just settled it.
    const done = await client
      ?.readContract({ address: m.auction, abi: auctionAbi, functionName: "cleared", args: [BigInt(b)] })
      .catch(() => false);
    if (done) return void refetchCleared();
    await tx.run(`Settling batch #${b}`, [
      (w) => w({ address: m.auction, abi: auctionAbi, functionName: "clear", args: [BigInt(b)] }),
    ]);
    refetchCleared();
  };

  useEffect(() => {
    if (!autoReveal || tx.busy) return;
    const next = due.find((o) => !attempted.current.has(o.salt));
    if (next) return void reveal(next);
    const b = unsettled.find((x) => !attempted.current.has(`settle:${x}`));
    if (b) settle(b);
  }); // runs every tick; `attempted` stops repeats

  const visible = store.orders.filter((o) => o.status !== "commit-failed").slice(0, 20);

  // Orders whose secret still has to be revealed from this browser.
  const needsTab = store.orders.filter(
    (o) => (o.status === "committed" || o.status === "pending") && BigInt(o.batchId) >= batchId,
  );

  // Ask before closing or leaving the page while an order still needs unsealing.
  useEffect(() => {
    if (needsTab.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [needsTab.length]);

  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Your orders</h2>
        <label className="small muted" style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={autoReveal} onChange={(e) => setAutoReveal(e.target.checked)} />
          Auto-unseal &amp; settle
        </label>
      </div>

      {!address ? (
        <div className="empty">Connect a wallet to see your orders.</div>
      ) : visible.length === 0 ? (
        <div className="empty">No orders yet. Whisper one ↑</div>
      ) : (
        <div className="orders">
          {visible.map((o) => (
            <OrderRow
              key={o.salt}
              m={m}
              o={o}
              trader={address}
              currentBatch={batchId}
              phase={phase}
              onReveal={() => reveal(o)}
              revealBusy={tx.busy}
            />
          ))}
        </div>
      )}

      {tx.msg && <div className={`status ${tx.msg.error ? "err" : "muted"}`}>{tx.msg.text}</div>}
      {address && needsTab.length > 0 && (
        <div className="notice keep-open" style={{ marginTop: 12 }}>
          <b>
            🤫 Keep this tab open:{" "}
            {phase === "whisper" ? `your order unseals in ${secondsLeft}s` : `unsealing now (${secondsLeft}s left)`}
          </b>
          <div style={{ marginTop: 4 }}>
            The secret that reveals your order lives only in this browser. Closed it by accident? Reopen this page
            before Unseal ends and it will still unseal automatically. Miss it and you lose the{" "}
            {Number(m.bond) / 10 ** m.quoteDecimals} {m.quoteSymbol} bond.
          </div>
        </div>
      )}
    </section>
  );
}

function OrderRow({ m, o, trader, currentBatch, phase, onReveal, revealBusy }: {
  m: Market;
  o: SavedOrder;
  trader: Address;
  currentBatch: bigint;
  phase: "whisper" | "unseal";
  onReveal: () => void;
  revealBusy: boolean;
}) {
  const client = usePublicClient();
  const batch = BigInt(o.batchId);
  const ended = batch < currentBatch;

  const { data } = useReadContracts({
    query: { enabled: ended, refetchInterval: (q) => (q.state.data?.[0]?.result ? false : 4_000) },
    contracts: [
      { address: m.auction, abi: auctionAbi, functionName: "cleared", args: [batch] },
      { address: m.auction, abi: auctionAbi, functionName: "clearingPrice", args: [batch] },
    ],
  });
  const cleared = data?.[0]?.result as boolean | undefined;
  const price = data?.[1]?.result as bigint | undefined;

  // Once cleared, look up our Filled event.
  const [fill, setFill] = useState<{ base: bigint; quote: bigint } | null | undefined>(undefined);
  useEffect(() => {
    if (!cleared || o.status !== "revealed" || fill !== undefined || !client) return;
    client
      .getContractEvents({
        address: m.auction,
        abi: auctionAbi,
        eventName: "Filled",
        args: { batchId: batch, index: BigInt(o.index!), trader },
        fromBlock: o.commitBlock ? BigInt(o.commitBlock) : undefined,
      })
      .then((logs) => {
        const l = logs[0];
        setFill(l ? { base: l.args.baseAmount!, quote: l.args.quoteAmount! } : null);
      })
      .catch(() => setFill(null));
  }, [cleared, o, fill, client, m.auction, batch, trader]);

  const amount = fmt(formatUnits(BigInt(o.amount), m.baseDecimals));
  const limit = fmt(fromRawPrice(m, BigInt(o.limitPrice)), 2);

  let badge: { text: string; cls: string };
  let action: React.ReactNode = null;
  if (o.status === "pending") badge = { text: "Sending…", cls: "" };
  else if (!ended && o.status === "committed" && (batch > currentBatch || phase === "whisper")) badge = { text: "Sealed 🤫", cls: "sealed" };
  else if (!ended && o.status === "committed") {
    badge = { text: "Unsealing…", cls: "live" };
    action = <button className="btn btn-sm" disabled={revealBusy} onClick={onReveal}>Unseal</button>;
  } else if (!ended && o.status === "revealed") badge = { text: "Waiting for The Fill", cls: "live" };
  else if (o.status === "committed") badge = { text: "Missed Unseal: bond lost", cls: "bad" };
  else if (cleared === false || cleared === undefined) badge = { text: "Waiting for settlement", cls: "live" };
  else if (price === 0n) badge = { text: "Batch cancelled: funds unlocked", cls: "" };
  else if (fill === undefined) badge = { text: "Checking fill…", cls: "" };
  else if (fill === null) badge = { text: `Not filled (price $${fmt(fromRawPrice(m, price!), 2)})`, cls: "" };
  else {
    const filledBase = fmt(formatUnits(fill.base, m.baseDecimals));
    badge = { text: `Filled ${filledBase} @ $${fmt(fromRawPrice(m, price!), 2)} ✓`, cls: "live" };
  }

  return (
    <div className="order">
      <span className={`side-tag ${o.isBuy ? "buy" : "sell"}`}>{o.isBuy ? "BUY" : "SELL"}</span>
      <div className="order-main">
        <div className="line1">
          {amount} {m.baseSymbol} <span className="muted">{o.isBuy ? "≤" : "≥"} ${limit}</span>
        </div>
        <div className="line2">Batch #{o.batchId}</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {action}
        <span className={`badge ${badge.cls}`}>{badge.text}</span>
      </div>
    </div>
  );
}
