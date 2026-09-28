// SPEC §6.2 — provider adapter. LLM_PROVIDER = anthropic | gemini | fixtures.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import type { z } from "zod";

export const PROMPT_VERSION = "2026-09-28.1";
const MAX_IMAGES = 16;
const CALL_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;

export type LLMImage = { label: string; mime: "image/jpeg" | "image/png"; data: Buffer };

export interface VisionLLM {
  id: string; // recorded in reports as `model`
  analyze<T>(args: {
    system: string;
    instruction: string;
    images: LLMImage[];
    schema: z.ZodType<T, z.ZodTypeDef, unknown>;
    maxTokens?: number;
    /** Fixture file name (src/ai/fixtures/{task}.json); ignored by real providers. */
    task?: string;
  }): Promise<{ output: T; raw: string }>;
}

export class LLMOutputError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
    this.name = "LLMOutputError";
  }
}

/** EXIF-rotate, long edge ≤ 1280 px, JPEG q80 (SPEC §6.2). */
export async function prepareImage(label: string, data: Buffer): Promise<LLMImage> {
  const out = await sharp(data)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { label, mime: "image/jpeg", data: out };
}

/** Strips ``` fences and parses the first JSON object in the text. */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no JSON object in model output");
  return JSON.parse(unfenced.slice(start, end + 1));
}

type RawCall = (system: string, instruction: string, images: LLMImage[], maxTokens: number) => Promise<string>;

/** Shared parse → validate → retry-with-error loop around one provider call. */
function withValidation(id: string, call: RawCall): VisionLLM {
  return {
    id,
    async analyze({ system, instruction, images, schema, maxTokens = 16_000 }) {
      if (images.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} images per call; batch per room`);
      let prompt = instruction;
      let raw = "";
      let lastError = "";
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        raw = await call(system, prompt, images, maxTokens);
        try {
          const parsed = schema.safeParse(extractJson(raw));
          if (parsed.success) return { output: parsed.data, raw };
          lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        } catch (e) {
          lastError = (e as Error).message;
        }
        prompt = `${instruction}\n\nYour previous answer was invalid (${lastError}). Respond again with one JSON object only, fixing these errors.`;
      }
      throw new LLMOutputError(`model output failed validation after ${MAX_RETRIES + 1} attempts: ${lastError}`, raw);
    },
  };
}

function anthropicLLM(model: string): VisionLLM {
  const client = new Anthropic({ timeout: CALL_TIMEOUT_MS });
  // No `temperature`: current Claude models reject sampling params (see docs/SPEC-CHANGES.md).
  return withValidation(`anthropic:${model}`, async (system, instruction, images, maxTokens) => {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const img of images) {
      content.push({ type: "text", text: `[${img.label}]` });
      content.push({ type: "image", source: { type: "base64", media_type: img.mime, data: img.data.toString("base64") } });
    }
    content.push({ type: "text", text: `${instruction}\n\nRespond with one JSON object only.` });
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content }],
    });
    // A refusal or truncation is treated as bad output: no attestation, humans decide (SPEC §6.1 fail safe).
    if (res.stop_reason === "refusal") throw new LLMOutputError("model declined the request");
    return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  });
}

function geminiLLM(model: string): VisionLLM {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const genAI = new GoogleGenerativeAI(key);
  return withValidation(`gemini:${model}`, async (system, instruction, images, maxTokens) => {
    const m = genAI.getGenerativeModel(
      {
        model,
        systemInstruction: system,
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: maxTokens },
      },
      { timeout: CALL_TIMEOUT_MS },
    );
    const parts = images.flatMap((img) => [
      { text: `[${img.label}]` },
      { inlineData: { mimeType: img.mime, data: img.data.toString("base64") } },
    ]);
    const res = await m.generateContent([...parts, { text: instruction }]);
    return res.response.text();
  });
}

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Canned outputs for tests and the offline demo. Reports carry model "fixtures" (UI shows the badge). */
function fixturesLLM(): VisionLLM {
  return {
    id: "fixtures",
    async analyze({ schema, task }) {
      if (!task) throw new Error("fixtures provider needs `task` to pick src/ai/fixtures/{task}.json");
      const raw = await readFile(path.join(FIXTURES_DIR, `${task}.json`), "utf8");
      const parsed = schema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new LLMOutputError(`fixture ${task}.json does not match its schema: ${parsed.error.message}`, raw);
      return { output: parsed.data, raw };
    },
  };
}

export function createLLM(): VisionLLM {
  const provider = process.env.LLM_PROVIDER ?? "fixtures";
  const model = process.env.LLM_MODEL;
  switch (provider) {
    case "anthropic":
      return anthropicLLM(model || "claude-opus-5");
    case "gemini":
      if (!model) throw new Error("LLM_MODEL must name a vision-capable Gemini model");
      return geminiLLM(model);
    case "fixtures":
      return fixturesLLM();
    default:
      throw new Error(`unknown LLM_PROVIDER: ${provider}`);
  }
}
