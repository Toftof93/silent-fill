"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { ConnectButton } from "./ConnectButton";
import { X_HANDLE, X_URL } from "@/lib/social";
import { robinhoodTestnet, visibleChains } from "@/lib/wagmi";

/* ------------------------------------------------------------------ the pool */

// A compressed, decorative batch: sealed orders sink in, unseal, then clear on one line.
const CYCLE = 14; // seconds
const ORDERS = [
  { a: 0.3, r: 0.86, t: 0.6 },
  { a: 2.1, r: 0.78, t: 1.4 },
  { a: 4.0, r: 0.9, t: 2.3 },
  { a: 5.2, r: 0.7, t: 3.1 },
  { a: 1.2, r: 0.95, t: 4.0 },
  { a: 3.3, r: 0.82, t: 4.8 },
  { a: 5.9, r: 0.88, t: 5.5 },
  { a: 2.7, r: 0.74, t: 6.2 },
];

function Pool() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = () => {
      setT(((performance.now() - start) / 1000) % CYCLE);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phase = t < 7.5 ? "Whisper" : t < 10.5 ? "Unseal" : "The Fill";
  const W = 640;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;
  const rx = 290;
  const ry = 110;
  const fill = phase === "The Fill" ? Math.min(1, (t - 10.5) / 0.8) : 0;
  const sweep = (t / CYCLE) * Math.PI * 2;

  return (
    <figure className="pool" aria-hidden>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        <defs>
          <radialGradient id="well" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0d1412" />
            <stop offset="70%" stopColor="#070908" />
            <stop offset="100%" stopColor="#050505" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="price" x1="0" x2="1">
            <stop offset="0" stopColor="#8fd3b6" stopOpacity="0" />
            <stop offset="0.5" stopColor="#8fd3b6" stopOpacity="0.9" />
            <stop offset="1" stopColor="#8fd3b6" stopOpacity="0" />
          </linearGradient>
        </defs>

        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#well)" />
        {[1, 0.78, 0.56, 0.34, 0.14].map((k, i) => (
          <ellipse key={i} cx={cx} cy={cy} rx={rx * k} ry={ry * k} fill="none" stroke="rgba(233,231,226,0.09)" strokeWidth="1" />
        ))}

        {/* slow sweep, like an instrument */}
        <line
          x1={cx}
          y1={cy}
          x2={cx + Math.cos(sweep) * rx}
          y2={cy + Math.sin(sweep) * ry}
          stroke="rgba(143,211,182,0.18)"
          strokeWidth="1"
        />

        {/* sealed orders drifting toward the centre */}
        {ORDERS.map((o, i) => {
          if (t < o.t) return null;
          const sink = Math.min(1, (t - o.t) / 6);
          const r = o.r * (1 - 0.55 * sink);
          const x = cx + Math.cos(o.a) * rx * r;
          const y = cy + Math.sin(o.a) * ry * r;
          const lit = phase !== "Whisper";
          const fade = phase === "The Fill" ? 1 - fill : 1;
          return (
            <g key={i} opacity={fade}>
              <circle cx={x} cy={y} r={lit ? 3.2 : 2.4} fill={lit ? "#8fd3b6" : "rgba(233,231,226,0.55)"} />
              {!lit && <circle cx={x} cy={y} r={7} fill="none" stroke="rgba(233,231,226,0.12)" />}
            </g>
          );
        })}

        {/* one price */}
        {fill > 0 && (
          <g opacity={fill}>
            <line x1={cx - rx * 0.92} y1={cy} x2={cx + rx * 0.92} y2={cy} stroke="url(#price)" strokeWidth="1.2" />
            <text x={cx} y={cy - 14} textAnchor="middle" className="pool-price">
              3,000.00
            </text>
          </g>
        )}
      </svg>
      <figcaption>
        <span>Batch 1,204</span>
        <span className="pool-phase">{phase}</span>
        <span>{phase === "Whisper" ? "Bots see: nothing" : phase === "Unseal" ? "Window closed" : "Everyone fills at one price"}</span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ page */

export function Landing({ deployed }: { deployed: boolean }) {
  const { isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const supported = visibleChains.some((c) => c.id === chainId);

  const primary = !isConnected ? (
    <ConnectButton className="btn-pill" label="Launch app" />
  ) : !supported ? (
    <button className="btn-pill" onClick={() => switchChain({ chainId: robinhoodTestnet.id })}>
      Switch to {robinhoodTestnet.name}
    </button>
  ) : !deployed ? (
    <a className="btn-pill" href="/deploy">Deploy from your wallet</a>
  ) : null;

  return (
    <div className="landing">
      <section className="hero">
        <p className="kicker">Sealed-bid dark pool · Robinhood Chain testnet</p>
        <h1 className="display">
          Filled.
          <br />
          <em>Not seen.</em>
        </h1>
        <p className="lead">
          Orders enter sealed. Nobody sees side, size or price until the batch closes, and then every match clears at
          one fair price.
        </p>
        <div className="cta">
          {primary}
          <a className="link-arrow" href="#how">How it works</a>
        </div>
        {isConnected && supported && !deployed && (
          <p className="hint">Silent Fill isn’t live on this network yet. Deploying from your wallet takes about two minutes.</p>
        )}
        <Pool />
      </section>

      <section className="figures">
        <div><b>0</b><span>Snipers fed</span></div>
        <div><b>1</b><span>Price per batch</span></div>
        <div><b>90s</b><span>Batch cycle</span></div>
        <div><b>0%</b><span>Price impact</span></div>
      </section>

      <section className="why">
        <div className="why-head">
          <p className="kicker">Why a dark pool</p>
          <h2 className="title">On a public exchange, every order is a signal.</h2>
        </div>
        <div className="table">
          <div className="tr th"><span /><span>Public DEX</span><span>Silent Fill</span></div>
          <div className="tr"><span>Your order</span><span>Broadcast before it executes</span><span>A sealed hash until the batch closes</span></div>
          <div className="tr"><span>Front-running</span><span>Bots buy ahead and sell after</span><span>Nothing to see, nothing to front-run</span></div>
          <div className="tr"><span>Price</span><span>Slides along the curve</span><span>One oracle midpoint for everyone</span></div>
          <div className="tr"><span>Size</span><span>Moves the market</span><span>No price impact</span></div>
        </div>
      </section>

      <section id="how" className="how">
        <p className="kicker">How a batch works</p>
        <ol className="steps3">
          <li>
            <span className="num">01</span>
            <h3>Whisper</h3>
            <p>Post a sealed order with a small refundable bond. On-chain it’s only a hash: no side, no size, no price.</p>
            <span className="dur">60 seconds</span>
          </li>
          <li>
            <span className="num">02</span>
            <h3>Unseal</h3>
            <p>The app reveals your order for you. The window is already closed to new orders, so there’s nobody left to react.</p>
            <span className="dur">30 seconds</span>
          </li>
          <li>
            <span className="num">03</span>
            <h3>The Fill</h3>
            <p>Every matching buy and sell settles at one oracle midpoint. If the price feed fails, the batch cancels and funds unlock.</p>
            <span className="dur">One transaction</span>
          </li>
        </ol>
      </section>

      <section className="faq">
        <p className="kicker">Questions</p>
        <details>
          <summary>What is a dark pool?</summary>
          <p>A venue where orders stay hidden until they trade, so the market can’t react to them first. Large traders have used them for decades.</p>
        </details>
        <details>
          <summary>What is the bond for?</summary>
          <p>A small deposit locked when you Whisper and returned when you Unseal. It keeps people from posting orders they never mean to reveal.</p>
        </details>
        <details>
          <summary>What price do I get?</summary>
          <p>The oracle midpoint at the end of the batch, as long as it’s within your limit. If it isn’t, your order simply doesn’t fill and your funds unlock.</p>
        </details>
        <details>
          <summary>Is this real money?</summary>
          <p>No. Silent Fill runs on Robinhood Chain testnet with test tokens from the built-in faucet, and it hasn’t been audited yet.</p>
        </details>
      </section>

      <section className="closing">
        <h2 className="display small">
          Trade <em>quiet.</em>
        </h2>
        <div className="cta center">
          {primary}
          <a className="link-arrow" href={X_URL} target="_blank" rel="noreferrer">Follow @{X_HANDLE}</a>
        </div>
      </section>
    </div>
  );
}
