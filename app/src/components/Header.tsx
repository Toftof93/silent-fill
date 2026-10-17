"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chains } from "@/lib/wagmi";

export function Header() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const wrongChain = isConnected && !chain;

  return (
    <header className="header">
      <div className="logo">
        <div className="logo-mark">✓</div>
        Silent Fill
        <span className="tagline">Filled. Not seen.</span>
      </div>
      <div className="header-right">
        {isConnected &&
          (wrongChain ? (
            <button className="btn btn-sm" onClick={() => switchChain({ chainId: chains[0].id })}>
              Switch to {chains[0].name}
            </button>
          ) : (
            <span className="pill">
              <span className="dot" />
              {chain?.name}
            </span>
          ))}
        {isConnected ? (
          <button className="btn btn-sm mono" onClick={() => disconnect()} title="Disconnect">
            {address!.slice(0, 6)}…{address!.slice(-4)}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            disabled={isPending || connectors.length === 0}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
        )}
      </div>
    </header>
  );
}
