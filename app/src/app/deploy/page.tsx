"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { getPublicClient, getWalletClient } from "wagmi/actions";
import type { Abi, Address, Hex, PublicClient, WalletClient } from "viem";
import { Header } from "@/components/Header";
import { auctionAbi, feedAbi, oracleAbi, tokenAbi, vaultAbi } from "@/lib/abi";
import { auctionBytecode, feedBytecode, oracleBytecode, tokenBytecode, vaultBytecode } from "@/lib/bytecode";
import { saveLocalDeployment, type Deployment } from "@/lib/market";
import { errorText } from "@/lib/hooks";
import { config, robinhoodTestnet } from "@/lib/wagmi";

// Testnet launch settings (match scripts/deploy.js defaults).
const COMMIT_SECONDS = 60n;
const REVEAL_SECONDS = 30n;
const BOND = 10n * 10n ** 6n; // 10 sUSDC
const MOCK_STALENESS = 365n * 24n * 3600n; // the mock feed never updates

type Progress = Partial<Deployment> & { linked?: boolean };

type Step = {
  key: keyof Deployment | "linked";
  label: string;
};

const STEPS: Step[] = [
  { key: "base", label: "Test token sWETH" },
  { key: "quote", label: "Test token sUSDC" },
  { key: "feed", label: "ETH/USD test price feed ($3,000)" },
  { key: "oracle", label: "SilentOracle" },
  { key: "vault", label: "SilentVault" },
  { key: "auction", label: "SilentAuction" },
  { key: "linked", label: "Connect vault ↔ auction" },
];

const progressKey = (chainId: number, account: string) => `silentfill:deploy:${chainId}:${account.toLowerCase()}`;

export default function DeployPage() {
  const { address, isConnected, chain } = useAccount();
  const chainId = useChainId();
  const { switchChain, switchChainAsync, isPending: switching, error: switchError } = useSwitchChain();

  const [progress, setProgress] = useState<Progress>({});
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) return;
    try {
      setProgress(JSON.parse(localStorage.getItem(progressKey(chainId, address)) || "{}"));
    } catch {
      setProgress({});
    }
  }, [address, chainId]);

  const save = (p: Progress) => {
    setProgress(p);
    try {
      localStorage.setItem(progressKey(chainId, address!), JSON.stringify(p));
    } catch {}
  };

  const deployWith = (wallet: WalletClient, client: PublicClient) => async (abi: Abi, bytecode: Hex, args: unknown[]): Promise<Address> => {
    const hash = await wallet.deployContract({ abi, bytecode, args, account: address!, chain: wallet.chain });
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Deployment reverted");
    return receipt.contractAddress;
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    let p = { ...progress };
    try {
      // Grab the wallet at click time (switching network first if needed) instead of
      // waiting on a hook, which some wallets are slow to populate.
      const target = chain?.id === 31337 ? 31337 : robinhoodTestnet.id;
      if (chain?.id !== target) {
        setCurrent("Switching network");
        await switchChainAsync({ chainId: target });
      }
      const wallet = await getWalletClient(config, { chainId: target });
      const client = getPublicClient(config, { chainId: target }) as PublicClient;
      const deploy = deployWith(wallet, client);
      for (const step of STEPS) {
        if (p[step.key]) continue;
        setCurrent(step.label);
        switch (step.key) {
          case "base":
            p.base = await deploy(tokenAbi, tokenBytecode, ["Silent WETH", "sWETH", 18]);
            break;
          case "quote":
            p.quote = await deploy(tokenAbi, tokenBytecode, ["Silent USDC", "sUSDC", 6]);
            break;
          case "feed":
            p.feed = await deploy(feedAbi, feedBytecode, [8, 3000n * 10n ** 8n]);
            break;
          case "oracle":
            p.oracle = await deploy(oracleAbi, oracleBytecode, [p.feed, MOCK_STALENESS, 18, 6]);
            break;
          case "vault":
            p.vault = await deploy(vaultAbi, vaultBytecode, [address]);
            break;
          case "auction":
            p.auction = await deploy(auctionAbi, auctionBytecode, [
              address, p.vault, p.base, p.quote, p.oracle, address, COMMIT_SECONDS, REVEAL_SECONDS, BOND,
            ]);
            break;
          case "linked": {
            const hash = await wallet.writeContract({
              address: p.vault!,
              abi: vaultAbi,
              functionName: "setAuction",
              args: [p.auction!, true],
              account: address!,
              chain: wallet.chain,
            });
            const r = await client.waitForTransactionReceipt({ hash });
            if (r.status !== "success") throw new Error("setAuction reverted");
            p.linked = true;
            break;
          }
        }
        p = { ...p };
        save(p);
      }
      const { linked: _, ...d } = p;
      saveLocalDeployment(chainId, d as Deployment);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
      setCurrent(null);
    }
  };

  const done = !!progress.linked;
  const { linked: _, ...addresses } = progress;
  const json = JSON.stringify({ [String(chainId)]: addresses }, null, 2);
  // `chain` is undefined when the wallet is on a network this app doesn't know.
  const wrongChain = isConnected && (!chain || (chain.id !== robinhoodTestnet.id && chain.id !== 31337));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <main className="wrap">
      <Header />
      <div style={{ maxWidth: 560, margin: "0 auto" }} className="stack">
        <section className="panel">
          <h2>Deploy Silent Fill</h2>
          <p className="muted small" style={{ marginTop: 0, lineHeight: 1.6 }}>
            Deploys the full testnet setup from your wallet: test tokens, a test price feed and the three Silent Fill
            contracts. You approve <b>7 transactions</b>. Your key never leaves your wallet. If you get interrupted,
            come back and tap Deploy again to continue where you left off.
          </p>

          {!isConnected ? (
            <div className="notice">Connect your wallet first (top right). On a phone, open this page inside your wallet app’s browser.</div>
          ) : wrongChain ? (
            <>
              <div className="notice" style={{ marginBottom: 12 }}>
                Your wallet is on a different network. Switch to {robinhoodTestnet.name} to deploy.
              </div>
              <button
                className="btn btn-primary btn-block"
                disabled={switching}
                onClick={() => switchChain({ chainId: robinhoodTestnet.id })}
              >
                {switching ? "Check your wallet…" : `Switch to ${robinhoodTestnet.name}`}
              </button>
              {switchError && (
                <div className="status err">
                  Couldn’t switch automatically. Open your wallet and pick {robinhoodTestnet.name} from its network list, then
                  reload.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="orders" style={{ margin: "12px 0 16px" }}>
                {STEPS.map((s, i) => {
                  const value = progress[s.key];
                  const active = current === s.label;
                  return (
                    <div className="order" key={s.key} style={{ gridTemplateColumns: "auto 1fr auto" }}>
                      <span className="side-tag buy">{i + 1}</span>
                      <div className="order-main">
                        <div className="line1" style={{ fontFamily: "var(--sans)" }}>{s.label}</div>
                        {typeof value === "string" && <div className="line2 mono">{value}</div>}
                      </div>
                      <span className={`badge ${value ? "live" : active ? "sealed" : ""}`}>
                        {value ? "Done ✓" : active ? "Confirm in wallet…" : "Waiting"}
                      </span>
                    </div>
                  );
                })}
              </div>

              {!done && (
                <button className="btn btn-primary btn-block" disabled={running} onClick={run}>
                  {running ? "Deploying…" : Object.keys(progress).length ? "Continue deploy" : "Deploy"}
                </button>
              )}
              {error && <div className="status err">{error}</div>}
            </>
          )}
        </section>

        {done && (
          <section className="panel">
            <h2>Done 🎉</h2>
            <p className="small muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
              Silent Fill is live on this network. It already works in <b>this browser</b>. To make it work for
              everyone, copy these addresses and send them to whoever maintains the repo (they go in{" "}
              <span className="mono">app/src/deployments.json</span>). Addresses are public, so they’re safe to share.
            </p>
            <pre className="mono small" style={{ background: "var(--bg)", padding: 12, borderRadius: 10, overflowX: "auto", border: "1px solid var(--line)" }}>
              {json}
            </pre>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button className="btn" onClick={copy}>{copied ? "Copied ✓" : "Copy addresses"}</button>
              <a className="btn btn-primary" href="/" style={{ textAlign: "center", textDecoration: "none" }}>
                Open Silent Fill
              </a>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
