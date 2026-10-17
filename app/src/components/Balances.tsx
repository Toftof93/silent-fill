"use client";

import { useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { tokenAbi, vaultAbi } from "@/lib/abi";
import { fmt, type Market } from "@/lib/market";
import { useBalances, useTx } from "@/lib/hooks";
import { chains } from "@/lib/wagmi";

const TESTNET_IDS: number[] = chains.filter((c) => c.testnet !== false).map((c) => c.id);

export function Balances({ m }: { m: Market }) {
  const { address } = useAccount();
  const chainId = useChainId();
  const b = useBalances(m);
  const tx = useTx();
  const [token, setToken] = useState<"base" | "quote">("quote");
  const [amount, setAmount] = useState("");

  const dec = token === "base" ? m.baseDecimals : m.quoteDecimals;
  const tokenAddr = token === "base" ? m.base : m.quote;
  const sym = token === "base" ? m.baseSymbol : m.quoteSymbol;
  let raw = 0n;
  try {
    raw = amount ? parseUnits(amount, dec) : 0n;
  } catch {}

  const deposit = async () => {
    const steps: Parameters<typeof tx.run>[1] = [];
    if (b.allowance[token] < raw) {
      steps.push((w) => w({ address: tokenAddr, abi: tokenAbi, functionName: "approve", args: [m.vault, raw] }));
    }
    steps.push((w) => w({ address: m.vault, abi: vaultAbi, functionName: "deposit", args: [tokenAddr, raw] }));
    if (await tx.run(`Deposit ${amount} ${sym}`, steps)) setAmount("");
    b.refetch();
  };

  const withdraw = async () => {
    if (await tx.run(`Withdraw ${amount} ${sym}`, [
      (w) => w({ address: m.vault, abi: vaultAbi, functionName: "withdraw", args: [tokenAddr, raw] }),
    ])) setAmount("");
    b.refetch();
  };

  const faucet = async () => {
    await tx.run("Faucet", [
      (w) => w({ address: m.base, abi: tokenAbi, functionName: "mint", args: [address!, parseUnits("10", m.baseDecimals)] }),
      (w) => w({ address: m.quote, abi: tokenAbi, functionName: "mint", args: [address!, parseUnits("50000", m.quoteDecimals)] }),
    ]);
    b.refetch();
  };

  const rows = [
    { key: "base" as const, sym: m.baseSymbol, dec: m.baseDecimals },
    { key: "quote" as const, sym: m.quoteSymbol, dec: m.quoteDecimals },
  ];
  const f = (v: bigint, d: number) => fmt(formatUnits(v, d));

  return (
    <section className="panel">
      <h2>Vault</h2>
      <table className="bal-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Wallet</th>
            <th>In vault</th>
            <th>Locked</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.sym}</td>
              <td>{f(b.wallet[r.key], r.dec)}</td>
              <td>{f(b.vault[r.key], r.dec)}</td>
              <td className="muted">{f(b.locked[r.key], r.dec)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stack" style={{ marginTop: 16, gap: 10 }}>
        <div className="seg">
          {rows.map((r) => (
            <button key={r.key} className={token === r.key ? "on" : ""} onClick={() => setToken(r.key)}>
              {r.sym}
            </button>
          ))}
        </div>
        <div className="field">
          <label>
            <span>Amount</span>
            <span>
              <a className="mono" style={{ cursor: "pointer" }} onClick={() => setAmount(formatUnits(b.wallet[token], dec))}>
                wallet max
              </a>
              {" · "}
              <a className="mono" style={{ cursor: "pointer" }} onClick={() => setAmount(formatUnits(b.available[token], dec))}>
                vault max
              </a>
            </span>
          </label>
          <div className="input-row">
            <input inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="unit">{sym}</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button className="btn btn-primary" disabled={tx.busy || raw === 0n || raw > b.wallet[token]} onClick={deposit}>
            Go Silent (deposit)
          </button>
          <button className="btn" disabled={tx.busy || raw === 0n || raw > b.available[token]} onClick={withdraw}>
            Withdraw
          </button>
        </div>
        {TESTNET_IDS.includes(chainId) && (
          <button className="btn btn-sm" disabled={tx.busy} onClick={faucet}>
            Testnet faucet: get 10 {m.baseSymbol} + 50,000 {m.quoteSymbol}
          </button>
        )}
      </div>
      {tx.msg && <div className={`status ${tx.msg.error ? "err" : "muted"}`}>{tx.msg.text}</div>}
    </section>
  );
}
