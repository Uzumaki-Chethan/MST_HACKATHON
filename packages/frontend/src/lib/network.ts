import { addChainParams, mstTestnet } from "@nestledger/shared";
import { appChain } from "./wagmi";

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

/** SPEC §8.1 network guard: switch, and on 4902 (unknown chain) add MST Testnet first. */
export async function ensureAppChain(provider: Eip1193): Promise<void> {
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === appChain.id) return;
  const chainId = `0x${appChain.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    const code = (e as { code?: number; data?: { originalError?: { code?: number } } }).code
      ?? (e as { data?: { originalError?: { code?: number } } }).data?.originalError?.code;
    if (code !== 4902 || appChain.id !== mstTestnet.id) throw e;
    await provider.request({ method: "wallet_addEthereumChain", params: [addChainParams] });
  }
}
