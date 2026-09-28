import { defineChain } from "viem";
export const mstTestnet = defineChain({
  id: 91562037,
  name: "MST Testnet",
  nativeCurrency: { name: "MST Native Coin", symbol: "tMSTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnetrpc.mstblockchain.com"],
                        webSocket: ["wss://testnetrpc.mstblockchain.com"] } },
  blockExplorers: { default: { name: "MSTScan", url: "https://testnet.mstscan.com" } },
  testnet: true,
});
export const explorerTx = (h: string) => `https://testnet.mstscan.com/tx/${h}`;
export const explorerAddress = (a: string) => `https://testnet.mstscan.com/address/${a}`;
// Parameters for wallet_addEthereumChain (BridgeKey)
export const addChainParams = {
  chainId: "0x5752035", chainName: "MST Testnet",
  nativeCurrency: { name: "MST Native Coin", symbol: "tMSTC", decimals: 18 },
  rpcUrls: ["https://testnetrpc.mstblockchain.com"],
  blockExplorerUrls: ["https://testnet.mstscan.com"],
};
