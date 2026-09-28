// SPEC §6.6 transaction hygiene: one queue at concurrency 1, staticCall first, 1 confirmation,
// idempotency key in `jobs`, 3 retries with backoff.
import type { Db } from "../db/index.js";

export type AttestCall = {
  /** Resolves if the call would succeed now; rejects (revert) if it is already done or no longer valid. */
  simulate(): Promise<unknown>;
  /** Sends and waits for 1 confirmation; returns the tx hash. */
  send(): Promise<string>;
};

type JobStatus = "pending" | "done" | "skipped" | "failed";

let chain: Promise<unknown> = Promise.resolve();
/** Serialises every attestor-wallet send so nonces never collide. */
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export function jobStatus(db: Db, key: string): JobStatus | undefined {
  return db.get<{ status: JobStatus }>("SELECT status FROM jobs WHERE key = ?", [key])?.status;
}

function setJob(db: Db, key: string, kind: string, status: JobStatus, fields: { error?: string; txHash?: string } = {}) {
  db.run(
    `INSERT INTO jobs (key, kind, status, attempts, last_error, tx_hash, updated_at) VALUES (?,?,?,1,?,?,?)
     ON CONFLICT(key) DO UPDATE SET status = excluded.status, attempts = jobs.attempts + 1,
       last_error = excluded.last_error, tx_hash = COALESCE(excluded.tx_hash, jobs.tx_hash), updated_at = excluded.updated_at`,
    [key, kind, status, fields.error ?? null, fields.txHash ?? null, Date.now()],
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs one idempotent on-chain write. Returns the tx hash, or null when it was skipped
 * (already attested, stale round, or no longer claimable) or failed after all retries.
 */
export async function runJob(
  db: Db,
  key: string,
  kind: string,
  call: AttestCall,
  opts: { retries?: number; backoffMs?: number } = {},
): Promise<string | null> {
  const status = jobStatus(db, key);
  if (status === "done" || status === "skipped") return null;
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 2000;

  return serial(async () => {
    try {
      await call.simulate();
    } catch (e) {
      setJob(db, key, kind, "skipped", { error: `staticCall reverted: ${(e as Error).message}` });
      return null;
    }
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const txHash = await call.send();
        setJob(db, key, kind, "done", { txHash });
        return txHash;
      } catch (e) {
        setJob(db, key, kind, attempt === retries ? "failed" : "pending", { error: (e as Error).message });
        if (attempt < retries) await sleep(backoff * 2 ** (attempt - 1));
      }
    }
    return null;
  });
}
