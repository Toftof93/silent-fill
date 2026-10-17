"use client";

import { useCallback, useEffect, useState } from "react";

/** A sealed order. The salt is the only thing that lets you reveal it, so it lives here until then. */
export type SavedOrder = {
  salt: `0x${string}`; // unique id
  batchId: string;
  index?: string; // set once the commit tx is mined
  isBuy: boolean;
  amount: string; // raw base units
  limitPrice: string; // raw price
  commitBlock?: string;
  status: "pending" | "committed" | "revealed" | "commit-failed";
  createdAt: number;
};

const key = (chainId: number, auction: string, account: string) =>
  `silentfill:orders:${chainId}:${auction.toLowerCase()}:${account.toLowerCase()}`;

function load(k: string): SavedOrder[] {
  try {
    return JSON.parse(localStorage.getItem(k) || "[]");
  } catch {
    return [];
  }
}

export function useSavedOrders(chainId: number, auction?: string, account?: string) {
  const k = auction && account ? key(chainId, auction, account) : undefined;
  const [orders, setOrders] = useState<SavedOrder[]>([]);

  useEffect(() => {
    setOrders(k ? load(k) : []);
    if (!k) return;
    const onStorage = (e: StorageEvent) => e.key === k && setOrders(load(k));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [k]);

  const save = useCallback(
    (update: (prev: SavedOrder[]) => SavedOrder[]) => {
      if (!k) return;
      const next = update(load(k));
      try {
        localStorage.setItem(k, JSON.stringify(next));
      } catch {}
      setOrders(next);
    },
    [k],
  );

  const add = useCallback((o: SavedOrder) => save((prev) => [o, ...prev]), [save]);
  const patch = useCallback(
    (salt: string, p: Partial<SavedOrder>) => save((prev) => prev.map((o) => (o.salt === salt ? { ...o, ...p } : o))),
    [save],
  );
  const remove = useCallback((salt: string) => save((prev) => prev.filter((o) => o.salt !== salt)), [save]);

  return { orders, add, patch, remove };
}
