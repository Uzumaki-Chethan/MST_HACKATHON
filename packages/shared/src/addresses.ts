// Overwritten by packages/contracts/scripts/deploy.ts. Do not edit by hand.
// 31337 = local hardhat node, 91562037 = MST Testnet.
export type ContractName =
  | "NestRegistry" | "NestPassport" | "RentalEscrow" | "MilestoneEscrow"
  | "DisputeResolver" | "SocietyLedger" | "TankerTrust";

export const addresses: Record<number, Partial<Record<ContractName, `0x${string}`>>> = {
  31337: {
    NestRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    NestPassport: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    RentalEscrow: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  },
  91562037: {
    NestRegistry: "0x87d7eeDF89Aeec6551534F54b80D23911A30F2a5",
    NestPassport: "0xCaE95713df4206C3359409d489A5169b97bEb153",
    RentalEscrow: "0xe5608B1C26D8d3E05a0C1846eEfB474eF87bedCb",
  },
};

/** Block each chain's contracts were deployed at (indexer START_BLOCK). */
export const DEPLOY_BLOCK: Record<number, number> = { 31337: 0, 91562037: 5787626 };
