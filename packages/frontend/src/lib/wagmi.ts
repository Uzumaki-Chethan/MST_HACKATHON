import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import { mstTestnet } from "@nestledger/shared";

/** Local hardhat node for developing before testnet addresses exist (NEXT_PUBLIC_CHAIN=local). */
export const localChain = defineChain({
  id: 31337,
  name: "Hardhat local",
  nativeCurrency: { name: "MST Native Coin", symbol: "tMSTC", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

/** The one chain the app works on; the network guard switches the wallet to it. */
export const appChain = process.env.NEXT_PUBLIC_CHAIN === "local" ? localChain : mstTestnet;

export const wagmiConfig = createConfig({
  chains: [mstTestnet, localChain],
  connectors: [injected()], // EIP-6963 discovery is on by default in wagmi v2
  // Reads go through the same-origin proxy (app/api/rpc/[network]) because the MST testnet RPC sends no CORS headers.
  transports: {
    [mstTestnet.id]: http("/api/rpc/testnet"),
    [localChain.id]: http("http://127.0.0.1:8545"),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
