// One process: HTTP API + indexer + keeper + AI agent (SPEC §7).
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { config, type Config } from "./config.js";
import { openDb, type Db } from "./db/index.js";
import { createChainClients } from "./chain/index.js";
import { errorHandler } from "./errors.js";
import { registerAuth } from "./auth/index.js";
import { registerEvidence, MAX_EVIDENCE_BYTES } from "./evidence/index.js";
import { registerManifests } from "./manifests/index.js";
import { registerHealth } from "./health.js";
import { loadAiModule, registerAiRoutes } from "./aiModule.js";
import { startIndexer } from "./indexer/index.js";
import { registerIndexerRoutes } from "./indexer/routes.js";
import { registerPublicPassport } from "./public/passport.js";
import { registerPublicSocieties } from "./public/societies.js";
import { registerGas } from "./gas/index.js";
import { startKeeper } from "./keeper/index.js";
import { registerCaptureSessions } from "./evidence/capture.js";

export async function buildServer(cfg: Config = config, db: Db = openDb(cfg.dataDir)) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
  await app.register(cors, { origin: cfg.publicWebOrigins });
  await app.register(multipart, { limits: { fileSize: MAX_EVIDENCE_BYTES } });
  app.setErrorHandler(errorHandler);

  const chain = createChainClients(cfg);
  const ai = await loadAiModule();
  const llm = ai.createLLM ? ai.createLLM() : null;
  // Not started here: main() subscribes the agent first so it never misses an event.
  const indexer = startIndexer({ db, source: chain.provider, chainId: cfg.chainId, startBlock: cfg.startBlock });

  registerHealth(app, db, chain, llm);
  registerAuth(app, db, cfg);
  registerEvidence(app, db, chain, ai);
  registerManifests(app, db, chain);
  registerAiRoutes(app, ai, { db, chain, llm });
  registerIndexerRoutes(app, db);
  registerPublicPassport(app, db, chain);
  registerPublicSocieties(app, db, chain);
  registerGas(app, db, chain.keeper, cfg.chainId, cfg.dripAmountWei);
  registerCaptureSessions(app, db, cfg);

  return { app, db, chain, ai, llm, indexer };
}

async function main() {
  const { app, db, chain, ai, llm, indexer } = await buildServer();
  if (ai.startAgent && llm) ai.startAgent({ indexer: indexer.events, db, chain, llm });
  else app.log.warn("AI agent not started (module or LLM missing)");
  indexer.start();
  startKeeper(db, chain.keeper, config.chainId);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

// Run only when executed directly (`tsx src/server.ts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
