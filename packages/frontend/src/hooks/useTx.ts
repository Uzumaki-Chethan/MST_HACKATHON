"use client";

// SPEC §8.2: confirm toast → wait for receipt → success toast with MSTScan link → refresh reads.
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Abi, Address, Hash, TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useToast } from "@/components/Toaster";
import { describeError } from "@/lib/labels";
import { ensureAppChain } from "@/lib/network";
import { appChain } from "@/lib/wagmi";

export type WriteParams = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint };

export function useTx() {
  const { connector } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: appChain.id });
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const send = useCallback(
    async (params: WriteParams, label: string): Promise<{ hash: Hash; receipt: TransactionReceipt }> => {
      if (!connector) throw new Error("Connect BridgeKey first");
      if (!publicClient) throw new Error("No RPC client for the app chain");
      setPending(true);
      const id = toast.show({ kind: "pending", text: `Confirm in BridgeKey: ${label}` });
      try {
        await ensureAppChain((await connector.getProvider()) as Parameters<typeof ensureAppChain>[0]);
        const hash = await writeContractAsync({ ...params, chainId: appChain.id } as never);
        toast.update(id, { text: `${label}: waiting for the block…`, hash });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`${label} was reverted on-chain.`);
        toast.update(id, { kind: "success", text: `${label}: confirmed`, hash });
        await queryClient.invalidateQueries();
        return { hash, receipt };
      } catch (e) {
        toast.update(id, { kind: "error", text: describeError(e) });
        throw e;
      } finally {
        setPending(false);
      }
    },
    [connector, publicClient, writeContractAsync, queryClient, toast],
  );

  return { send, pending };
}
