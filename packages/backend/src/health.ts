// SPEC §7.3 GET /health: the demo readiness page reads this.
import type { FastifyInstance } from "fastify";
import { formatEther } from "ethers";
import type { ChainClients } from "./chain/index.js";
import type { Db } from "./db/index.js";

export function registerHealth(
  app: FastifyInstance, db: Db, chain: ChainClients & { keeper: { address: string } }, llm: { id?: string } | null,
) {
  app.get("/health", async () => {
    let rpcOk = false, block: number | null = null, attestorBalance: string | null = null, keeperBalance: string | null = null;
    try {
      block = await chain.provider.getBlockNumber();
      rpcOk = true;
      const [a, k] = await Promise.all([
        chain.provider.getBalance(chain.attestor.address),
        chain.provider.getBalance(chain.keeper.address),
      ]);
      attestorBalance = formatEther(a);
      keeperBalance = formatEther(k);
    } catch {
      // rpcOk stays false
    }
    const state = db.get<{ last_block: number }>("SELECT last_block FROM indexer_state WHERE id = 1");
    return {
      rpcOk, block, attestorBalance, keeperBalance,
      attestor: chain.attestor.address, keeper: chain.keeper.address,
      llm: llm?.id ?? "unavailable",
      indexerLag: block !== null && state ? block - state.last_block : null,
    };
  });
}
