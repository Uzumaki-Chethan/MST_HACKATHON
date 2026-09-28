// SPEC §7.3: every error is {error: {code, message}} with HTTP 400, 401, 403, 404 or 500.
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, "BAD_REQUEST", msg);
export const unauthorized = (msg = "Sign in first") => new HttpError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "Not allowed") => new HttpError(403, "FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new HttpError(404, "NOT_FOUND", msg);

export function errorHandler(err: FastifyError | Error, _req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: { code: "BAD_REQUEST", message: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") } });
  }
  // Errors thrown by Laptop 2's AI tasks (agreed in CLAUDE2.md).
  if ((err as { code?: string }).code === "NOT_FOUND") {
    return reply.status(404).send({ error: { code: "NOT_FOUND", message: err.message } });
  }
  if (err.name === "LLMOutputError") {
    return reply.status(502).send({ error: { code: "AI_OUTPUT", message: err.message } });
  }
  const status = (err as FastifyError).statusCode;
  if (status && status >= 400 && status < 500) {
    return reply.status(status).send({ error: { code: "BAD_REQUEST", message: err.message } });
  }
  console.error(err);
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
}
