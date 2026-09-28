// SPEC §7.4. Thin synchronous wrapper over better-sqlite3, shared with the AI agent (Laptop 2).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nonces    (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS evidence  (hash TEXT PRIMARY KEY, mime TEXT, size INTEGER, path TEXT, phash TEXT,
                        uploader TEXT, context_type TEXT, context_id TEXT, stage TEXT,
                        meta_json TEXT, checks_json TEXT, is_public INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS manifests (hash TEXT PRIMARY KEY, schema TEXT, json TEXT, uploader TEXT,
                        context_type TEXT, context_id TEXT, is_public INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS reports   (hash TEXT PRIMARY KEY, task TEXT, json TEXT, context_type TEXT, context_id TEXT,
                        model TEXT, prompt_version TEXT, is_public INTEGER DEFAULT 0, created_at INTEGER);
CREATE TABLE IF NOT EXISTS events    (id INTEGER PRIMARY KEY AUTOINCREMENT, contract TEXT, name TEXT, block INTEGER,
                        tx_hash TEXT, log_index INTEGER, ts INTEGER, args_json TEXT,
                        k1 TEXT, k2 TEXT, UNIQUE(tx_hash, log_index));
CREATE INDEX IF NOT EXISTS events_k ON events(contract, k1);
CREATE TABLE IF NOT EXISTS indexer_state (id INTEGER PRIMARY KEY CHECK (id = 1), last_block INTEGER);
-- small key/value store (e.g. which deployment the indexed events belong to; not in SPEC §7.4)
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS jobs      (key TEXT PRIMARY KEY, kind TEXT, status TEXT, attempts INTEGER DEFAULT 0,
                        last_error TEXT, tx_hash TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS drips     (address TEXT PRIMARY KEY, tx_hash TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS telemetry (device TEXT, litres INTEGER, distance_mm INTEGER, ts INTEGER);
-- QR capture handoff (P1, not in SPEC §7.4; see SPEC-CHANGES)
CREATE TABLE IF NOT EXISTS capture_sessions (token TEXT PRIMARY KEY, creator TEXT, context_type TEXT, context_id TEXT,
                        stage TEXT, template TEXT, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS capture_uploads (token TEXT, hash TEXT, created_at INTEGER, PRIMARY KEY (token, hash));
`;

export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  /** Runs fn inside one SQLite transaction (all or nothing). */
  transaction<T>(fn: () => T): T;
  /** Directory where evidence files are stored as DATA_DIR/evidence/{hash}. */
  evidenceDir: string;
  close(): void;
};

/** Opens (or creates) DATA_DIR/nestledger.sqlite. Pass ":memory:" as dataDir for tests. */
export function openDb(dataDir: string): Db {
  const inMemory = dataDir === ":memory:";
  const evidenceDir = inMemory ? fs.mkdtempSync(path.join(os.tmpdir(), "nestledger-evidence-")) : path.join(dataDir, "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const sqlite = new Database(inMemory ? ":memory:" : path.join(dataDir, "nestledger.sqlite"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(SCHEMA);

  return {
    query: (sql, params = []) => sqlite.prepare(sql).all(...params) as never,
    get: (sql, params = []) => sqlite.prepare(sql).get(...params) as never,
    run: (sql, params = []) => sqlite.prepare(sql).run(...params),
    transaction: (fn) => sqlite.transaction(fn)(),
    evidenceDir,
    close: () => sqlite.close(),
  };
}
