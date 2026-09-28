// Overwritten by packages/contracts/scripts/deploy.ts. Do not edit by hand.
// 31337 = local hardhat node, 91562037 = MST Testnet.
export type ContractName =
  | "NestRegistry" | "NestPassport" | "RentalEscrow" | "MilestoneEscrow"
  | "DisputeResolver" | "SocietyLedger" | "TankerTrust";

export const addresses: Record<number, Partial<Record<ContractName, `0x${string}`>>> = {
  31337: {
    NestRegistry: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    NestPassport: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    RentalEscrow: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    MilestoneEscrow: "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    DisputeResolver: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    SocietyLedger: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  },
  91562037: {
    NestRegistry: "0x53cdf6bfF53357f60c5eC9Dd4552f243837ec9f8",
    NestPassport: "0x7d8706C27ed1385E37a516Bd1094Fc0e4a3B8002",
    RentalEscrow: "0xEF1ed68f299B47d78719b4a7a635E7e610753629",
    MilestoneEscrow: "0x20feF97Dae8b896f7ca08740Fb176D1b32a1846a",
    DisputeResolver: "0x7868AcEb5f4d043476793086198870d90Bfe78d4",
    SocietyLedger: "0xb19d9d63A50b14C35c3DFFF9e5b8C8E7C6923377",
  },
};

/** Block each chain's contracts were deployed at (indexer START_BLOCK). */
export const DEPLOY_BLOCK: Record<number, number> = { 31337: 0, 91562037: 5789828 };
