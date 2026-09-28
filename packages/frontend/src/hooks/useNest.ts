"use client";

import { useAccount } from "wagmi";
import {
  addresses,
  disputeResolverAbi,
  milestoneEscrowAbi,
  nestPassportAbi,
  nestRegistryAbi,
  rentalEscrowAbi,
  societyLedgerAbi,
  tankerTrustAbi,
  type ContractName,
} from "@nestledger/shared";
import { appChain } from "@/lib/wagmi";

type Address = `0x${string}`;

function contract<A>(name: ContractName, abi: A) {
  return { address: addresses[appChain.id]?.[name] as Address | undefined, abi };
}

/** Contract handles for the app chain. `address` is undefined until Laptop 1 deploys. */
export const nestContracts = {
  registry: contract("NestRegistry", nestRegistryAbi),
  passport: contract("NestPassport", nestPassportAbi),
  rental: contract("RentalEscrow", rentalEscrowAbi),
  milestone: contract("MilestoneEscrow", milestoneEscrowAbi),
  resolver: contract("DisputeResolver", disputeResolverAbi),
  ledger: contract("SocietyLedger", societyLedgerAbi),
  tanker: contract("TankerTrust", tankerTrustAbi),
};

export function useNest() {
  const { address, chainId } = useAccount();
  return { address, chainId, onAppChain: chainId === appChain.id, contracts: nestContracts };
}
