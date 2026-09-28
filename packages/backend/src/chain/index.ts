// Server-side chain access (ethers v6). ChainClients shape agreed with Laptop 2 (CLAUDE1/CLAUDE2).
import { JsonRpcProvider, Wallet } from "ethers";
import { addresses, type ContractName } from "@nestledger/shared";
import type { Config } from "../config.js";

export type ChainClients = {
  provider: JsonRpcProvider;
  /** AI attestor wallet (ATTESTOR_ROLE). Random and unfunded when ATTESTOR_PRIVATE_KEY is unset. */
  attestor: Wallet;
  chainId: number;
};

export function createChainClients(cfg: Config): ChainClients & { keeper: Wallet } {
  const provider = new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true });
  const wallet = (key: string, name: string) => {
    if (key) return new Wallet(key, provider);
    console.warn(`[chain] ${name} key not set; using a random unfunded wallet`);
    return new Wallet(Wallet.createRandom().privateKey, provider);
  };
  return {
    provider,
    attestor: wallet(cfg.attestorPrivateKey, "ATTESTOR_PRIVATE_KEY"),
    keeper: wallet(cfg.keeperPrivateKey, "KEEPER_PRIVATE_KEY"),
    chainId: cfg.chainId,
  };
}

/** Deployed address for this chain, or undefined before the first deploy. */
export function addressOf(chainId: number, name: ContractName): string | undefined {
  return addresses[chainId]?.[name];
}
