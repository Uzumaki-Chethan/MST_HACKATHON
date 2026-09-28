import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { z } from "zod";
import { createLLM, extractJson, LLMOutputError, prepareImage } from "./llm";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const schema = z.object({ ok: z.boolean(), confidence: z.number().min(0).max(1) });

describe("extractJson", () => {
  it("strips code fences and surrounding prose", () => {
    expect(extractJson('Here:\n```json\n{"ok": true, "confidence": 0.9}\n```')).toEqual({ ok: true, confidence: 0.9 });
  });
  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("fixtures provider", () => {
  beforeAll(async () => {
    await mkdir(fixtures, { recursive: true });
    await writeFile(path.join(fixtures, "__test_ok.json"), JSON.stringify({ ok: true, confidence: 0.8 }));
    await writeFile(path.join(fixtures, "__test_bad.json"), JSON.stringify({ ok: "yes" }));
  });
  afterAll(async () => {
    await rm(path.join(fixtures, "__test_ok.json"), { force: true });
    await rm(path.join(fixtures, "__test_bad.json"), { force: true });
  });

  it("returns the validated fixture and id 'fixtures'", async () => {
    process.env.LLM_PROVIDER = "fixtures";
    const llm = createLLM();
    expect(llm.id).toBe("fixtures");
    const { output } = await llm.analyze({ system: "", instruction: "", images: [], schema, task: "__test_ok" });
    expect(output).toEqual({ ok: true, confidence: 0.8 });
  });

  it("rejects a fixture that doesn't match the schema", async () => {
    const llm = createLLM();
    await expect(llm.analyze({ system: "", instruction: "", images: [], schema, task: "__test_bad" })).rejects.toBeInstanceOf(
      LLMOutputError,
    );
  });
});

describe("prepareImage", () => {
  it("resizes to a ≤1280 px JPEG", async () => {
    const png = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#888" } }).png().toBuffer();
    const img = await prepareImage("living-wide", png);
    const meta = await sharp(img.data).metadata();
    expect(img.mime).toBe("image/jpeg");
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(1280);
  });
});
