import fs from "fs";
import path from "path";

type ContractRecord = Record<
  string,
  { address: string; abi: unknown; constructorArguments: unknown[] }
>;
type Deployments = Record<string, ContractRecord & { _meta?: any }>;

const DEPLOYMENTS_JSON = path.join(__dirname, "..", "..", "deployments.json");
const SHARED_ADDRESSES_TS = path.join(__dirname, "..", "..", "..", "shared", "src", "addresses.ts");

const CHAIN_IDS: Record<string, number> = { hardhat: 31337, localhost: 31337, testnet: 91562037 };
const NAMES = ["NestRegistry", "NestPassport", "RentalEscrow", "MilestoneEscrow", "DisputeResolver", "SocietyLedger", "TankerTrust"];

function readDeployments(): Deployments {
  if (!fs.existsSync(DEPLOYMENTS_JSON)) return {};
  return JSON.parse(fs.readFileSync(DEPLOYMENTS_JSON, "utf8"));
}

/** Writes deployments.json (read by verify.ts) and packages/shared/src/addresses.ts (read by every package). */
export function writeDeploymentAddresses(network: string, deployed: ContractRecord, startBlock: number): void {
  const all = readDeployments();
  // A fresh deploy replaces the network's previous set (a v2 redeploys everything).
  all[network] = { ...deployed, _meta: { startBlock, deployedAt: new Date().toISOString() } } as any;
  fs.writeFileSync(DEPLOYMENTS_JSON, JSON.stringify(all, null, 2) + "\n");

  const byChain: Record<number, Record<string, string>> = { 31337: {}, 91562037: {} };
  const blocks: Record<number, number> = { 31337: 0, 91562037: 0 };
  for (const [net, record] of Object.entries(all)) {
    const chainId = CHAIN_IDS[net];
    if (!chainId || net === "hardhat") continue;
    for (const name of NAMES) if (record[name]) byChain[chainId][name] = record[name].address;
    blocks[chainId] = (record as any)._meta?.startBlock ?? 0;
  }
  const fmt = (o: Record<string, string>) =>
    "{" + Object.entries(o).map(([k, v]) => `\n    ${k}: "${v}",`).join("") + (Object.keys(o).length ? "\n  " : "") + "}";

  fs.writeFileSync(
    SHARED_ADDRESSES_TS,
    `// Overwritten by packages/contracts/scripts/deploy.ts. Do not edit by hand.
// 31337 = local hardhat node, 91562037 = MST Testnet.
export type ContractName =
  | "NestRegistry" | "NestPassport" | "RentalEscrow" | "MilestoneEscrow"
  | "DisputeResolver" | "SocietyLedger" | "TankerTrust";

export const addresses: Record<number, Partial<Record<ContractName, \`0x\${string}\`>>> = {
  31337: ${fmt(byChain[31337])},
  91562037: ${fmt(byChain[91562037])},
};

/** Block each chain's contracts were deployed at (indexer START_BLOCK). */
export const DEPLOY_BLOCK: Record<number, number> = { 31337: ${blocks[31337]}, 91562037: ${blocks[91562037]} };
`,
  );
}
