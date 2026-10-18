"use client";

import { useEffect, useRef, useState } from "react";
import { useConnect, type Connector } from "wagmi";
import { errorText } from "@/lib/hooks";

/** Wallets announced via EIP-6963 (Rabby, MetaMask…) first; the generic "Injected" one last, and only if alone. */
function pickable(connectors: readonly Connector[]): Connector[] {
  const named = connectors.filter((c) => c.id !== "injected");
  const seen = new Set<string>();
  const unique = named.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
  return unique.length ? unique : connectors.filter((c) => c.id === "injected");
}

export function ConnectButton({ className = "btn btn-primary btn-sm", label = "Connect wallet" }: {
  className?: string;
  label?: string;
}) {
  const { connect, connectors, isPending, error, reset } = useConnect();
  const [open, setOpen] = useState(false);
  const [hasWallet, setHasWallet] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const options = pickable(connectors);

  useEffect(() => {
    setHasWallet(typeof window !== "undefined" && ("ethereum" in window || options.some((c) => c.id !== "injected")));
  }, [options.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const go = (c: Connector) => {
    reset();
    setOpen(false);
    connect({ connector: c });
  };

  const onClick = () => {
    if (!hasWallet) return setOpen(true);
    if (options.length === 1) return go(options[0]);
    setOpen((o) => !o);
  };

  return (
    <div className="connect" ref={ref}>
      <button className={className} disabled={isPending} onClick={onClick}>
        {isPending ? "Check your wallet…" : label}
      </button>
      {open && (
        <div className="connect-menu">
          {!hasWallet ? (
            <div className="small muted" style={{ padding: 8, lineHeight: 1.5 }}>
              No wallet found in this browser. Install <b>Rabby</b> or <b>MetaMask</b>, make sure it’s turned on for
              this site, then reload.
            </div>
          ) : (
            <>
              <div className="small muted" style={{ padding: "6px 8px" }}>Choose a wallet</div>
              {options.map((c) => (
                <button key={c.uid} className="connect-opt" onClick={() => go(c)}>
                  {c.icon && <img src={c.icon} alt="" width={20} height={20} />}
                  {c.name === "Injected" ? "Browser wallet" : c.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {error && (
        <div className="connect-err">
          {errorText(error)}
          <div className="muted" style={{ marginTop: 4 }}>
            Open your wallet extension, unlock it, and check for a pending connection request.
          </div>
        </div>
      )}
    </div>
  );
}
