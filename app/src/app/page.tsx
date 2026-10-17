"use client";

import { useAccount, useChainId } from "wagmi";
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
  const { address } = useAccount();
  const deployment = useDeployment();
  const m = useMarket();
  const now = useNow();
  const store = useSavedOrders(chainId, deployment?.auction, address);

  return (
    <main className="wrap">
      <Header />

      {!address || !deployment ? (
        <Landing deployed={!!deployment} />
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
