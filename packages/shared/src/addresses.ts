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
    NestRegistry: "0x5212a77a5b2bCAC1087442E6e2Bd6f8E20D066F8",
    NestPassport: "0x2cf688D321e886861BD0B780e0878017EcA2B98A",
    RentalEscrow: "0x9C545aB0b33d7707E8725974eB6285AE64855A9C",
    MilestoneEscrow: "0xb617d533479eeC236399C0874a42CCcce70b526F",
    DisputeResolver: "0xfee1810E16AdC5A4348Ba018Cfc439f5fCCBabB1",
    SocietyLedger: "0x8f33F06C739DeafbDb043854F693935Eb244c1C0",
  },
};

/** Block each chain's contracts were deployed at (indexer START_BLOCK). */
export const DEPLOY_BLOCK: Record<number, number> = { 31337: 0, 91562037: 5796145 };
