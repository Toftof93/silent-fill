"use client";

import { useEffect, useState } from "react";
import { useChainId, useReadContracts } from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import deployments from "@/deployments.json";
import { auctionAbi, oracleAbi, tokenAbi } from "./abi";

export type Deployment = {
  base: Address;
  quote: Address;
  feed: Address;
  oracle: Address;
  vault: Address;
  auction: Address;
};

export function useDeployment(): Deployment | undefined {
  const chainId = useChainId();
  return (deployments as Record<string, Deployment>)[String(chainId)];
}

/** Static market parameters + live oracle price. */
export function useMarket() {
  const d = useDeployment();
  const { data, refetch } = useReadContracts({
    allowFailure: true,
    query: { enabled: !!d, refetchInterval: 10_000 },
    contracts: d
      ? [
          { address: d.auction, abi: auctionAbi, functionName: "genesis" },
          { address: d.auction, abi: auctionAbi, functionName: "commitDuration" },
          { address: d.auction, abi: auctionAbi, functionName: "revealDuration" },
          { address: d.auction, abi: auctionAbi, functionName: "bond" },
          { address: d.auction, abi: auctionAbi, functionName: "feeBps" },
          { address: d.base, abi: tokenAbi, functionName: "decimals" },
          { address: d.quote, abi: tokenAbi, functionName: "decimals" },
          { address: d.base, abi: tokenAbi, functionName: "symbol" },
          { address: d.quote, abi: tokenAbi, functionName: "symbol" },
          { address: d.oracle, abi: oracleAbi, functionName: "price" },
        ]
      : [],
  });

  if (!d || !data || data.slice(0, 9).some((r) => r.status !== "success")) return undefined;
  const v = data.map((r) => r.result);
  return {
    ...d,
    genesis: Number(v[0] as bigint),
    commitDuration: Number(v[1] as bigint),
    revealDuration: Number(v[2] as bigint),
    bond: v[3] as bigint,
    feeBps: v[4] as bigint,
    baseDecimals: v[5] as number,
    quoteDecimals: v[6] as number,
    baseSymbol: v[7] as string,
    quoteSymbol: v[8] as string,
    oraclePrice: data[9]?.status === "success" ? (v[9] as bigint) : undefined,
    refetch,
  };
}

export type Market = NonNullable<ReturnType<typeof useMarket>>;

/** Wall-clock seconds, ticking once a second. */
export function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type Phase = "whisper" | "unseal";

export function batchClock(m: Market, now: number) {
  const period = m.commitDuration + m.revealDuration;
  const elapsed = Math.max(0, now - m.genesis);
  const batchId = BigInt(Math.floor(elapsed / period));
  const offset = elapsed % period;
  const phase: Phase = offset < m.commitDuration ? "whisper" : "unseal";
  const secondsLeft = phase === "whisper" ? m.commitDuration - offset : period - offset;
  return { batchId, phase, secondsLeft, period };
}

// Prices are raw quote units per 1e18 raw base units (same as the contracts).
export function toRawPrice(m: Market, human: string): bigint {
  return (parseUnits(human, m.quoteDecimals) * 10n ** 18n) / 10n ** BigInt(m.baseDecimals);
}

export function fromRawPrice(m: Market, raw: bigint): string {
  return formatUnits((raw * 10n ** BigInt(m.baseDecimals)) / 10n ** 18n, m.quoteDecimals);
}

export function fmt(value: string, maxDecimals = 4): string {
  const [i, f = ""] = value.split(".");
  const int = Number(i).toLocaleString("en-US");
  const frac = f.slice(0, maxDecimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}
