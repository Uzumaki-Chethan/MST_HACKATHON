// SPEC §7.3 GET /public/passport/:address: no login; chain reads plus recent indexed activity.
import type { FastifyInstance } from "fastify";
import { Contract, isAddress } from "ethers";
import { nestPassportAbi, nestRegistryAbi, Stat } from "@nestledger/shared";
import type { ChainClients } from "../chain/index.js";
import { addressOf } from "../chain/index.js";
import type { Db } from "../db/index.js";
import { badRequest, HttpError } from "../errors.js";
import { toTimelineItem } from "../indexer/routes.js";

export function registerPublicPassport(app: FastifyInstance, db: Db, chain: ChainClients) {
  app.get<{ Params: { address: string } }>("/public/passport/:address", async (req) => {
    const address = req.params.address.toLowerCase();
    if (!isAddress(address)) throw badRequest("Not an address");
    const passportAddr = addressOf(chain.chainId, "NestPassport");
    const registryAddr = addressOf(chain.chainId, "NestRegistry");
    if (!passportAddr || !registryAddr) throw new HttpError(503, "NOT_DEPLOYED", "NestPassport is not deployed on this chain");

    const passport = new Contract(passportAddr, nestPassportAbi, chain.provider);
    const registry = new Contract(registryAddr, nestRegistryAbi, chain.provider);
    const [has, raw, tier, score, profile] = await Promise.all([
      passport.hasPassport(address), passport.statsOf(address), passport.tenantTier(address),
      passport.trustScore(address), registry.profileOf(address),
    ]);
    const stats = Object.fromEntries(Stat.map((name, i) => [name, Number(raw[i])]));
    const recent = db.query<Parameters<typeof toTimelineItem>[0]>(
      "SELECT * FROM events WHERE args_json LIKE ? ORDER BY block DESC, log_index DESC LIMIT 20", [`%"${address}"%`]);
    return {
      address, hasPassport: has, verified: profile.verified, kinds: Number(profile.kinds),
      registeredAt: Number(profile.registeredAt), tier: Number(tier), score: Number(score), stats,
      recent: recent.map(toTimelineItem),
    };
  });
}
