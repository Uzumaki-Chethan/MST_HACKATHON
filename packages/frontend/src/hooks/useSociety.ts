"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { nestContracts } from "@/hooks/useNest";
import type { Flat, Proposal, Society } from "@/lib/society";
import { appChain } from "@/lib/wagmi";

export type FlatRow = Flat & { id: bigint };
export type ProposalRow = Proposal & { id: bigint; canExecute: boolean; reason: string; required: number; effectiveTier: number };
export type SocietyData = { society: Society; available: bigint; flats: FlatRow[]; proposals: ProposalRow[] };

/** Everything a society page shows, read straight from SocietyLedger (no wallet needed). */
export function useSocietyData(id: string) {
  const client = usePublicClient({ chainId: appChain.id });
  const ledger = nestContracts.ledger;
  return useQuery({
    queryKey: ["society", id],
    enabled: !!ledger.address && !!client,
    refetchInterval: 5000,
    queryFn: async (): Promise<SocietyData> => {
      const read = <T>(functionName: string, args: unknown[]) =>
        client!.readContract({ address: ledger.address!, abi: ledger.abi, functionName: functionName as never, args: args as never }) as Promise<T>;
      const sid = BigInt(id);
      const [society, available, flatIds, proposalIds] = await Promise.all([
        read<Society>("getSociety", [sid]),
        read<bigint>("availableBalance", [sid]),
        read<readonly bigint[]>("flatsOf", [sid]),
        read<readonly bigint[]>("proposalsOf", [sid]),
      ]);
      const flats = await Promise.all(flatIds.map(async (fid) => ({ ...(await read<Flat>("getFlat", [fid])), id: fid })));
      const proposals = await Promise.all(
        proposalIds.map(async (pid) => {
          const [p, [ok, reason], required, eff] = await Promise.all([
            read<Proposal>("getProposal", [pid]),
            read<readonly [boolean, string]>("canExecute", [pid]),
            read<number>("requiredApprovals", [pid]),
            read<number>("effectiveTier", [pid]),
          ]);
          return { ...p, id: pid, canExecute: ok, reason, required: Number(required), effectiveTier: Number(eff) };
        }),
      );
      return { society, available, flats, proposals: proposals.reverse() };
    },
  });
}

export type Order = {
  supplier: `0x${string}`; device: `0x${string}`; litresOrdered: number; pricePerLitre: bigint; escrowed: bigint;
  delivered: number; deadline: bigint; status: number;
};

export function useOrders(id: string) {
  const client = usePublicClient({ chainId: appChain.id });
  const tanker = nestContracts.tanker;
  return useQuery({
    queryKey: ["orders", id],
    enabled: !!tanker.address && !!client,
    refetchInterval: 5000,
    queryFn: async () => {
      const read = <T>(fn: string, args: unknown[]) =>
        client!.readContract({ address: tanker.address!, abi: tanker.abi, functionName: fn as never, args: args as never }) as Promise<T>;
      const ids = await read<readonly bigint[]>("ordersOf", [BigInt(id)]);
      return Promise.all(ids.map(async (oid) => ({ ...(await read<Order>("getOrder", [oid])), id: oid }))).then((xs) => xs.reverse());
    },
  });
}

