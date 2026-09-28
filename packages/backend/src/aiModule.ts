// Glue between the server (Laptop 1) and the AI code in src/ai + src/agent (Laptop 2).
// Signatures are the ones agreed in CLAUDE2.md. Loaded dynamically so the server still starts
// (answering 503 on /ai/*) before Laptop 2's modules exist.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ChainClients } from "./chain/index.js";
import type { Db } from "./db/index.js";
import type { IndexerEvents } from "./indexer/types.js";
import { requireUser } from "./auth/index.js";
import { HttpError } from "./errors.js";

type Fn = (...args: any[]) => any;
export type AiModule = {
  createLLM?: () => any;
  checkEvidence?: (file: Buffer, meta: unknown, ctx: { db: Db; receivedAt: number; location: { lat: number; lng: number } | null }) => Promise<Record<string, unknown>>;
  runMoveIn?: Fn;
  runMoveOut?: Fn;
  runMilestonePreview?: Fn;
  runInvoicePreview?: Fn;
  startAgent?: (deps: { indexer: IndexerEvents; db: Db; chain: ChainClients; llm: any }) => void;
};

async function tryImport(spec: string): Promise<Record<string, any>> {
  try {
    return await import(spec);
  } catch (err) {
    const missing = /ERR_MODULE_NOT_FOUND|Cannot find module|Failed to load url/.test(
      `${(err as { code?: string }).code} ${(err as Error).message}`);
    if (!missing) console.warn(`[ai] failed to load ${spec}:`, (err as Error).message);
    return {};
  }
}

export async function loadAiModule(): Promise<AiModule> {
  const ai = await tryImport("./ai/index.js");
  const agent = await tryImport("./agent/index.js");
  return { ...ai, startAgent: agent.startAgent };
}

const unavailable = () => new HttpError(503, "AI_UNAVAILABLE", "AI module not loaded yet");

export function registerAiRoutes(app: FastifyInstance, ai: AiModule, deps: { db: Db; chain: ChainClients; llm: any }) {
  const route = (path: string, schema: z.ZodTypeAny, fn: keyof AiModule) =>
    app.post(path, async (req) => {
      requireUser(req);
      const run = ai[fn] as Fn | undefined;
      if (!run || !deps.llm) throw unavailable();
      return run(schema.parse(req.body), deps);
    });

  const hash = z.string().regex(/^0x[0-9a-f]{64}$/);
  route("/ai/move-in", z.object({ leaseId: z.string(), bundleHash: hash }), "runMoveIn");
  route("/ai/move-out", z.object({ leaseId: z.string(), bundleHash: hash }), "runMoveOut");
  route("/ai/milestone/preview",
    z.object({ projectId: z.string(), milestoneIndex: z.number().int().min(0), bundleHash: hash }), "runMilestonePreview");
  route("/ai/invoice/preview",
    z.object({ societyId: z.string(), bundleHash: hash, payee: z.string(), amountWei: z.string().regex(/^\d+$/) }), "runInvoicePreview");
}
