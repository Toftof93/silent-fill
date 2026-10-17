"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { BaseError, type Hash, type TransactionReceipt } from "viem";
import { tokenAbi, vaultAbi } from "./abi";
import type { Market } from "./market";

/** Wallet + vault balances and vault allowances for both tokens. */
export function useBalances(m?: Market) {
  const { address } = useAccount();
  const enabled = !!m && !!address;
  const a = address!;
  const { data, refetch } = useReadContracts({
    query: { enabled, refetchInterval: 6_000 },
    contracts: enabled
      ? [
          { address: m.base, abi: tokenAbi, functionName: "balanceOf", args: [a] },
          { address: m.quote, abi: tokenAbi, functionName: "balanceOf", args: [a] },
          { address: m.vault, abi: vaultAbi, functionName: "balanceOf", args: [a, m.base] },
          { address: m.vault, abi: vaultAbi, functionName: "balanceOf", args: [a, m.quote] },
          { address: m.vault, abi: vaultAbi, functionName: "lockedOf", args: [a, m.base] },
          { address: m.vault, abi: vaultAbi, functionName: "lockedOf", args: [a, m.quote] },
          { address: m.base, abi: tokenAbi, functionName: "allowance", args: [a, m.vault] },
          { address: m.quote, abi: tokenAbi, functionName: "allowance", args: [a, m.vault] },
        ]
      : [],
  });
  const v = (i: number) => (data?.[i]?.result as bigint | undefined) ?? 0n;
  return {
    loaded: !!data,
    wallet: { base: v(0), quote: v(1) },
    vault: { base: v(2), quote: v(3) },
    locked: { base: v(4), quote: v(5) },
    available: { base: v(2) - v(4), quote: v(3) - v(5) },
    allowance: { base: v(6), quote: v(7) },
    refetch,
  };
}

/** Sends a tx, waits for it, and keeps a human-readable status line. */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const run = useCallback(
    async (
      label: string,
      steps: ((write: typeof writeContractAsync) => Promise<Hash>)[],
    ): Promise<TransactionReceipt | undefined> => {
      setBusy(true);
      setMsg({ text: `${label}: confirm in your wallet…` });
      try {
        let receipt: TransactionReceipt | undefined;
        for (const step of steps) {
          const hash = await step(writeContractAsync);
          setMsg({ text: `${label}: waiting for confirmation…` });
          receipt = await client!.waitForTransactionReceipt({ hash });
          if (receipt.status !== "success") throw new Error("Transaction reverted");
        }
        setMsg({ text: `${label}: done ✓` });
        return receipt;
      } catch (e) {
        setMsg({ text: `${label} failed: ${errorText(e)}`, error: true });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [writeContractAsync, client],
  );

  return { busy, msg, setMsg, run };
}

export function errorText(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  if (e instanceof Error) return e.message.split("\n")[0];
  return String(e);
}
