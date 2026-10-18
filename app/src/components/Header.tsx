"use client";

import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { chains } from "@/lib/wagmi";

export function Header() {
  const { address, isConnected, chain } = useAccount();
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
          <ConnectButton />
        )}
      </div>
    </header>
  );
}
