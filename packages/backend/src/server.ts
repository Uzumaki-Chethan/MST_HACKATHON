// One process: HTTP API + indexer + keeper + AI agent (SPEC §7).
import { EventEmitter } from "node:events";
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
import type { IndexerEvents } from "./indexer/types.js";

export async function buildServer(cfg: Config = config, db: Db = openDb(cfg.dataDir)) {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
  await app.register(cors, { origin: cfg.publicWebOrigin });
  await app.register(multipart, { limits: { fileSize: MAX_EVIDENCE_BYTES } });
  app.setErrorHandler(errorHandler);

  const chain = createChainClients(cfg);
  const ai = await loadAiModule();
  const llm = ai.createLLM ? ai.createLLM() : null;
  const indexer = new EventEmitter() as IndexerEvents; // fed by src/indexer in D1

  registerHealth(app, db, chain, llm);
  registerAuth(app, db, cfg);
  registerEvidence(app, db, chain, ai);
  registerManifests(app, db, chain);
  registerAiRoutes(app, ai, { db, chain, llm });

  return { app, db, chain, ai, llm, indexer };
}

async function main() {
  const { app, db, chain, ai, llm, indexer } = await buildServer();
  if (ai.startAgent && llm) ai.startAgent({ indexer, db, chain, llm });
  else app.log.warn("AI agent not started (module or LLM missing)");
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

// Run only when executed directly (`tsx src/server.ts`), not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
