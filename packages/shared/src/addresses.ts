// Overwritten by packages/contracts/scripts/deploy.ts. Do not edit by hand.
// 31337 = local hardhat node, 91562037 = MST Testnet.
export type ContractName =
  | "NestRegistry" | "NestPassport" | "RentalEscrow" | "MilestoneEscrow"
  | "DisputeResolver" | "SocietyLedger" | "TankerTrust";

export const addresses: Record<number, Partial<Record<ContractName, `0x${string}`>>> = {
  31337: {
    NestRegistry: "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44",
    NestPassport: "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f",
    RentalEscrow: "0x09635F643e140090A9A8Dcd712eD6285858ceBef",
    MilestoneEscrow: "0xc5a5C42992dECbae36851359345FE25997F5C42d",
    DisputeResolver: "0x7a2088a1bFc9d81c55368AE168C2C02570cB814F",
  },
  91562037: {
    NestRegistry: "0x87d7eeDF89Aeec6551534F54b80D23911A30F2a5",
    NestPassport: "0xCaE95713df4206C3359409d489A5169b97bEb153",
    RentalEscrow: "0xe5608B1C26D8d3E05a0C1846eEfB474eF87bedCb",
  },
};

/** Block each chain's contracts were deployed at (indexer START_BLOCK). */
export const DEPLOY_BLOCK: Record<number, number> = { 31337: 23, 91562037: 5787626 };
