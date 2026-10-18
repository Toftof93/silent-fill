"use client";

import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { robinhoodTestnet } from "@/lib/wagmi";
import { Header } from "@/components/Header";
import { Landing } from "@/components/Landing";
import { BatchClock } from "@/components/BatchClock";
import { Balances } from "@/components/Balances";
import { OrderForm } from "@/components/OrderForm";
import { MyOrders } from "@/components/MyOrders";
import { useDeployment, useMarket, useNow } from "@/lib/market";
import { useSavedOrders } from "@/lib/orders";

export default function Home() {
  const chainId = useChainId();
  const { address, chain } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const deployment = useDeployment();
  const m = useMarket();
  const now = useNow();
  const store = useSavedOrders(chainId, deployment?.auction, address);

  return (
    <main className="wrap">
      <Header />

      {!address || !deployment ? (
        <Landing deployed={!!deployment} />
      ) : !chain ? (
        <div className="hero-empty">
          <h1 className="display small">Wrong <em>network.</em></h1>
          <p>Your wallet is on a network Silent Fill doesn’t run on. Switch to {robinhoodTestnet.name} to trade.</p>
          <button className="btn-pill" disabled={switching} onClick={() => switchChain({ chainId: robinhoodTestnet.id })}>
            {switching ? "Check your wallet…" : `Switch to ${robinhoodTestnet.name}`}
          </button>
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
