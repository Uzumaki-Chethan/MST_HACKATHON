// SPEC §7.3 POST /gas/drip (N16): one small tMSTC top-up per registered wallet, from the keeper wallet.
import type { FastifyInstance } from "fastify";
import { Contract, type Wallet } from "ethers";
import { nestRegistryAbi } from "@nestledger/shared";
import type { Db } from "../db/index.js";
import { addressOf } from "../chain/index.js";
import { requireUser } from "../auth/index.js";
import { HttpError, forbidden } from "../errors.js";

export function registerGas(app: FastifyInstance, db: Db, keeper: Wallet, chainId: number, dripAmountWei: bigint) {
  app.post("/gas/drip", async (req) => {
    const user = requireUser(req);
    const done = db.get<{ tx_hash: string }>("SELECT tx_hash FROM drips WHERE address = ?", [user]);
    if (done) throw new HttpError(409, "ALREADY_DRIPPED", `Already topped up: ${done.tx_hash}`);

    const registryAddr = addressOf(chainId, "NestRegistry");
    if (!registryAddr) throw new HttpError(503, "NOT_DEPLOYED", "NestRegistry is not deployed on this chain");
    const registry = new Contract(registryAddr, nestRegistryAbi, keeper.provider);
    if (!(await registry.isRegistered(user))) throw forbidden("Register on-chain first (NestRegistry.register)");

    // Claim the slot before sending so two parallel requests can't both drip.
    const claimed = db.run("INSERT OR IGNORE INTO drips (address, tx_hash, created_at) VALUES (?, 'pending', ?)", [user, Date.now()]);
    if (claimed.changes === 0) throw new HttpError(409, "ALREADY_DRIPPED", "Top-up already in progress");
    try {
      const tx = await keeper.sendTransaction({ to: user, value: dripAmountWei });
      db.run("UPDATE drips SET tx_hash = ? WHERE address = ?", [tx.hash, user]);
      return { txHash: tx.hash };
    } catch (err) {
      db.run("DELETE FROM drips WHERE address = ?", [user]);
      throw new HttpError(502, "DRIP_FAILED", (err as Error).message.slice(0, 200));
    }
  });
}
