"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { robinhoodTestnet, visibleChains } from "@/lib/wagmi";

const DEMO_PERIOD = 90;
const DEMO_COMMIT = 60;

/** Decorative preview of a batch: orders arrive sealed, then all fill at one price. */
function SealedBook() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((x) => (x + 1) % DEMO_PERIOD), 1000);
    return () => clearInterval(id);
  }, []);

  const whisper = t < DEMO_COMMIT;
  const left = whisper ? DEMO_COMMIT - t : DEMO_PERIOD - t;
  const rows = [
    { side: "BUY", at: 4 },
    { side: "SELL", at: 11 },
    { side: "BUY", at: 19 },
    { side: "SELL", at: 27 },
    { side: "BUY", at: 38 },
    { side: "SELL", at: 49 },
  ];
  const visible = rows.filter((r) => t >= r.at || !whisper);

  return (
    <div className="book" aria-hidden>
      <div className="book-head">
        <span className="mono muted small">BATCH #1,204</span>
        <span className={`book-phase ${whisper ? "w" : "u"}`}>{whisper ? "Whisper" : "Unseal"}</span>
        <span className="mono">{left}s</span>
      </div>
      <div className="bar">
        <div style={{ width: `${(Math.min(t, DEMO_COMMIT) / DEMO_PERIOD) * 100}%`, background: "var(--violet)" }} />
        <div style={{ width: `${(Math.max(0, t - DEMO_COMMIT) / DEMO_PERIOD) * 100}%`, background: "var(--mint)" }} />
      </div>
      <div className="book-rows">
        {visible.map((r, i) => (
          <div className="book-row" key={i}>
            <span className={`side-tag ${whisper ? "hidden" : r.side === "BUY" ? "buy" : "sell"}`}>
              {whisper ? "????" : r.side}
            </span>
            <span className={`redact ${whisper ? "" : "open"}`}>{whisper ? "████████" : `${(0.5 + i * 0.37).toFixed(2)} ETH`}</span>
            <span className={`redact ${whisper ? "" : "open"}`}>{whisper ? "█████" : "$3,000"}</span>
            <span className="lock">{whisper ? "🔒" : "✓"}</span>
          </div>
        ))}
        {visible.length === 0 && <div className="muted small" style={{ padding: "14px 0" }}>Waiting for sealed orders…</div>}
      </div>
      <div className="book-foot">
        <span className="muted small">Bots can see:</span>
        <span className="mono small">{whisper ? "nothing" : "too late, batch is closed"}</span>
      </div>
    </div>
  );
}

export function Landing({ deployed }: { deployed: boolean }) {
  const { isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain } = useSwitchChain();
  const [hasWallet, setHasWallet] = useState(true);
  useEffect(() => setHasWallet(typeof window !== "undefined" && "ethereum" in window), []);
  const canConnect = hasWallet && connectors.length > 0;
  const supported = visibleChains.some((c) => c.id === chainId);

  const primary = !isConnected ? (
    <button
      className="btn btn-primary btn-lg"
      disabled={isPending || !canConnect}
      onClick={() => connect({ connector: connectors[0] })}
    >
      {isPending ? "Connecting…" : "Launch app"}
    </button>
  ) : !supported ? (
    <button className="btn btn-primary btn-lg" onClick={() => switchChain({ chainId: robinhoodTestnet.id })}>
      Switch to {robinhoodTestnet.name}
    </button>
  ) : !deployed ? (
    <a className="btn btn-primary btn-lg" href="/deploy">Deploy from your wallet →</a>
  ) : null;

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="dot" /> Dark pool · Robinhood Chain Testnet
          </div>
          <h1>
            Filled.
            <br />
            <span className="glow">Not seen.</span>
          </h1>
          <p className="lead">
            Trade size without showing your hand. Orders go in sealed, nobody sees side, size or price, and every
            match fills at <b>one fair price</b>. No front-running. No sandwiches. No price impact.
          </p>
          <div className="cta-row">
            {primary}
            <a className="btn btn-lg btn-ghost" href="#how">How it works</a>
          </div>
          {!canConnect && !isConnected && (
            <p className="small muted" style={{ marginTop: 12 }}>
              No wallet found. Install Rabby or MetaMask, or open this page in your wallet app’s browser.
            </p>
          )}
          {isConnected && supported && !deployed && (
            <p className="small muted" style={{ marginTop: 12 }}>
              Silent Fill isn’t live on this network yet. Deploy it from your wallet in about 2 minutes.
            </p>
          )}
        </div>
        <SealedBook />
      </section>

      <section className="strip">
        <div><b className="mint">0</b><span>snipers fed</span></div>
        <div><b>1</b><span>price per batch</span></div>
        <div><b>90s</b><span>batch cycle</span></div>
        <div><b>0%</b><span>price impact</span></div>
      </section>

      <section className="compare">
        <div className="cmp bad">
          <h3>On a normal DEX</h3>
          <ul>
            <li>Your swap sits in the public mempool</li>
            <li>Bots buy in front of you and sell right after</li>
            <li>Big orders slide down the AMM curve</li>
            <li>Whale wallets get tracked and copy-traded</li>
          </ul>
        </div>
        <div className="cmp good">
          <h3>On Silent Fill</h3>
          <ul>
            <li>Orders are sealed hashes until the batch closes</li>
            <li>Nothing to front-run: everyone gets the same price</li>
            <li>Fills at the oracle midpoint, not along a curve</li>
            <li>Bigger side fills pro-rata; leftovers just unlock</li>
          </ul>
        </div>
      </section>

      <section id="how" className="how">
        <h2 className="section-title">How a batch works</h2>
        <div className="how-grid">
          <div className="how-card">
            <div className="how-num violet">01</div>
            <h3>Whisper</h3>
            <p>Post a sealed order with a small refundable bond. On-chain it’s just a hash: no side, no size, no price.</p>
            <span className="mono small muted">60 seconds</span>
          </div>
          <div className="how-card">
            <div className="how-num mint">02</div>
            <h3>Unseal</h3>
            <p>The app reveals your order for you. The window is closed to new orders, so there’s nobody left to front-run.</p>
            <span className="mono small muted">30 seconds</span>
          </div>
          <div className="how-card">
            <div className="how-num">03</div>
            <h3>The Fill</h3>
            <p>Every matching buy and sell settles at one oracle midpoint price. If the price feed breaks, the batch cancels and funds unlock.</p>
            <span className="mono small muted">one transaction</span>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="feat">
          <div className="feat-icon">🤫</div>
          <h3>Sealed orders</h3>
          <p>Commit-reveal keeps your intent hidden while orders are being collected.</p>
        </div>
        <div className="feat">
          <div className="feat-icon">⚖️</div>
          <h3>One fair price</h3>
          <p>Every fill in a batch clears at the same price. No one gets a better deal for being faster.</p>
        </div>
        <div className="feat">
          <div className="feat-icon">🛡️</div>
          <h3>Funds never trapped</h3>
          <p>Bad oracle? The batch cancels and everything unlocks. Withdraw free balance any time.</p>
        </div>
        <div className="feat">
          <div className="feat-icon">🔑</div>
          <h3>Your keys</h3>
          <p>Non-custodial smart contracts. You sign every action from your own wallet.</p>
        </div>
      </section>

      <section className="faq">
        <h2 className="section-title">FAQ</h2>
        <details>
          <summary>What is a dark pool?</summary>
          <p>A venue where orders are hidden until they trade. Big traders use them so the market can’t react to their order before it fills.</p>
        </details>
        <details>
          <summary>What’s the bond for?</summary>
          <p>A small deposit locked when you Whisper and returned when you Unseal. It stops people from posting orders they never intend to reveal.</p>
        </details>
        <details>
          <summary>What price do I get?</summary>
          <p>The oracle midpoint at the end of the batch, as long as it’s within your limit. If it isn’t, your order simply doesn’t fill and your funds unlock.</p>
        </details>
        <details>
          <summary>Is this real money?</summary>
          <p>No. Silent Fill is on Robinhood Chain <b>testnet</b> with test tokens from the built-in faucet. It hasn’t been audited yet.</p>
        </details>
      </section>

      <section className="final-cta">
        <h2>Trade quiet.</h2>
        <div className="cta-row" style={{ justifyContent: "center" }}>{primary}</div>
      </section>
    </div>
  );
}
