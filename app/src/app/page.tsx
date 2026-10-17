"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { Header } from "@/components/Header";
import { BatchClock } from "@/components/BatchClock";
import { Balances } from "@/components/Balances";
import { OrderForm } from "@/components/OrderForm";
import { MyOrders } from "@/components/MyOrders";
import { useDeployment, useMarket, useNow } from "@/lib/market";
import { useSavedOrders } from "@/lib/orders";
import { chains } from "@/lib/wagmi";

export default function Home() {
  const chainId = useChainId();
  const { address } = useAccount();
  const { switchChain } = useSwitchChain();
  const deployment = useDeployment();
  const m = useMarket();
  const now = useNow();
  const store = useSavedOrders(chainId, deployment?.auction, address);

  return (
    <main className="wrap">
      <Header />

      {!deployment ? (
        <div className="hero-empty">
          <h1>Filled. Not seen.</h1>
          <p>Silent Fill isn’t deployed on this network yet.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
            <a className="btn btn-primary" href="/deploy" style={{ textDecoration: "none" }}>
              Deploy it from your wallet →
            </a>
            {chains.map((c) => (
              <button key={c.id} className="btn" onClick={() => switchChain({ chainId: c.id })}>
                Switch to {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : !m ? (
        <div className="hero-empty">
          <p>Loading market…</p>
        </div>
      ) : (
        <div className="grid">
          <div className="stack">
            <BatchClock m={m} now={now} />
            <MyOrders m={m} now={now} store={store} />
          </div>
          <div className="stack">
            <OrderForm m={m} now={now} onCommitted={store} />
            <Balances m={m} />
          </div>
        </div>
      )}

      <footer className="footer">
        Silent Fill · sealed-bid batch auctions on Robinhood Chain · unaudited testnet software
      </footer>
    </main>
  );
}
