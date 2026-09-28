// SPEC §7.1. Secrets live in the repo-root .env.local (see .env.example).
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, "..", "..", "..", ".env.local") });

const env = process.env;

// Comma-separated frontend origins (CORS + SIWE domains), e.g. the tunnel URL and localhost.
// The first one is the public origin used in links (QR capture URLs).
const webOrigins = (env.PUBLIC_WEB_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

export const config = {
  port: Number(env.PORT || 8080),
  rpcUrl: env.RPC_URL || "https://testnetrpc.mstblockchain.com",
  chainId: Number(env.CHAIN_ID || 91562037),
  dataDir: path.resolve(env.DATA_DIR || path.join(here, "..", "data")),
  jwtSecret: env.JWT_SECRET || "dev-only-jwt-secret-change-me",
  publicWebOrigins: webOrigins,
  publicWebOrigin: webOrigins[0],
  attestorPrivateKey: env.ATTESTOR_PRIVATE_KEY || "",
  keeperPrivateKey: env.KEEPER_PRIVATE_KEY || "",
  dripAmountWei: BigInt(env.DRIP_AMOUNT_WEI || "20000000000000000"),
  llmProvider: env.LLM_PROVIDER || "fixtures",
  startBlock: env.START_BLOCK ? Number(env.START_BLOCK) : undefined,
};

export type Config = typeof config;
