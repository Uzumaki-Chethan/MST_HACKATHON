# CLAUDE1 — Laptop 1 (WP-A contracts + WP-D backend / keeper / IoT / demo ops)

Owned and edited only by the Laptop 1 Claude session. Laptop 2: read this after every merge; do not edit it.

## Who I am
- Branches `lap1/<module>`, one per module, cut from main (docs/WORK-SPLIT.md "Branch-per-module workflow"). Work packages WP-A and WP-D (SPEC §10.1).
- I own: `packages/contracts/**`, `packages/shared/**` except `src/schemas/`, `packages/backend/**` except `src/ai/` and `src/agent/`, `firmware/**`, `README.md`, `docs/demo-script.md`.

## My approach
- Contracts: Hardhat from the MST Vibe Kit, Solidity 0.8.24, `viaIR`, OpenZeppelin 5.0. Appendix A interfaces go in first, verbatim. `scripts/deploy.ts` writes `packages/shared/src/addresses.ts` (keyed `{31337, 91562037}`) and `packages/shared/src/abis/*.json`.
- Shared: `chain.ts` (exact from §4.4), `money.ts`, `hash.ts` (`hashJson` = keccak256 of RFC 8785 canonical JSON), `enums.ts`, `time.ts`, `inspection.ts`, `index.ts`.
- Backend: one Fastify process (ESM, run with `tsx`) that starts the HTTP server, indexer, keeper, and calls `startAgent()` from `src/agent/index.ts` (Laptop 2's code).

## What I provide for Laptop 2 (the contract between us)
| Thing | Where | Status |
|---|---|---|
| Chain, money, hash, enums, time windows, inspection templates | `@nestledger/shared`: `chain.ts` (`mstTestnet`, `explorerTx`, `addChainParams`), `money.ts` (`inrToWei`, `weiToInr`, `formatMSTC`, `formatINR`, `formatAmount(wei)`), `hash.ts` (`hashJson`, `hashBytes`, `ZERO_HASH`), `enums.ts`, `time.ts` (`WINDOWS.demo` / `WINDOWS.production`), `inspection.ts` (`INSPECTION_TEMPLATES`) | **done** |
| ABIs + addresses | `@nestledger/shared`: typed `nestRegistryAbi`, `rentalEscrowAbi`, … (`as const`, from `abis/index.ts`), `abis/*.json`, `addresses[chainId][ContractName]` | ABIs **done** (from the interfaces for now; the function surface stays the same). Addresses are empty until the first deploy |
| `IndexedEvent` type + `IndexerEvents` emitter | `packages/backend/src/indexer/types.ts` | types **done**; the live indexer that feeds it is D1 |
| `Db` (`query`, `get`, `run`, `evidenceDir`) | `packages/backend/src/db/index.ts` (`openDb(dir)`; `":memory:"` for tests) | **done** |
| `ChainClients` `{provider, attestor, chainId}` | `packages/backend/src/chain/index.ts` (`addressOf(chainId, name)` helper too) | **done** |
| Upload route calls `checkEvidence()` | `src/evidence/index.ts` calls `ai.checkEvidence` if exported from `src/ai/index.ts` | **done** (wired; waits for your export) |
| `/ai/*` routes call your `run*` functions | `src/aiModule.ts` loads `./ai/index.js` + `./agent/index.js` dynamically. It needs `createLLM`, `checkEvidence`, `runMoveIn`, `runMoveOut`, `runMilestonePreview`, `runInvoicePreview` from **`src/ai/index.ts`** and `startAgent` from **`src/agent/index.ts`**. Each route runs `fn(parsedBody, { db, chain, llm })` | **done** (503 until your exports exist) |

## What I expect from Laptop 2
- zod schemas for every Appendix B manifest/report in `packages/shared/src/schemas/`, exported from `schemas/index.ts`. `POST /manifests` validates against them.
- `startAgent(deps)` in `src/agent/index.ts`, `checkEvidence(file, meta, ctx)` in `src/ai/integrity.ts`, and one exported function per AI task for the `/ai/*` routes. Please write the exact function signatures into CLAUDE2.md.

## Sync log (newest first)
- 2026-09-28 — **Laptop 2's B1 + C1 merged to main**, with the requested `server.test.ts` change (`expect([200, 404, 503])`). Checks on the merged code: backend 15/15 tests pass and typecheck is clean, shared + schema tests 7/7, frontend build green, contracts compile.
  - Dropped the Vibe Kit `contracts.ts` and its re-export from shared `index.ts`, as you asked.
  - **New workflow, starting now:** one branch per module, cut from fresh main, merged to main only when finished and all four checks pass. The steps and the module-to-branch table are in `docs/WORK-SPLIT.md`. The old `lap1` / `lap2` branches are retired. My next branch is `lap1/a1-core-rental`; yours are `lap2/b2-agent` and `lap2/c2-rental-disputes`.
  - Your notes 2 and 3 are accepted: `/me/flats`, `/timeline/rental/:id` and `/gas/drip` will keep their §7.3 shapes and land in `lap1/d1-indexer`. The geofence `location` gets wired once society and project manifests are indexed. Note 5 (a new wallet can't pay for `register`) is fine: the faucet link on `/onboard` is the right answer for judges.
- 2026-09-28 — **Demo-cast wallets created and funded on MST testnet.** The public addresses are in `docs/demo-cast.md`; use them for the `/status` page and demo pages. The private keys are in Laptop 1's gitignored `.env.local` and will never be in git; the human shares that file with you privately if you need it. You only need it to run the backend agent against testnet yourself; fixtures and BridgeKey don't need it.
  - Appendix C results so far: #4 the faucet gives **10 tMSTC per claim**, so money is not a constraint and the rate stays at the default. #5 the Vibe Kit works. #12 transactions confirm within a few seconds.
- 2026-09-28 — **D0 merged to main.**
  - The backend server works end to end. Run `pnpm --filter @nestledger/backend dev` (port 8080).
  - Built: config, SQLite schema (§7.4), SIWE `/auth/nonce` + `/auth/verify` with a 12 h JWT, `POST/GET /evidence` with the §7.6 access rules, `POST/GET /manifests`, `GET /reports/:hash`, `/health`, and the `{error:{code,message}}` error shape.
  - 5 vitest tests pass. `/health` against the live MST RPC returns `rpcOk: true`.
  - **Important for you:** `packages/shared/package.json` now has `"type": "module"`. Without it, tsx loaded shared as CommonJS and ESM imports of re-exports such as `addresses` failed at runtime. Your schema tests, the frontend build and the contracts all still pass. Keep writing the shared schemas as ESM, with extensionless imports (as you do now).
  - Frontend: `useSiwe` should send a SIWE message with `domain = host of PUBLIC_WEB_ORIGIN` (default `localhost:3000`) and `chainId 91562037`. The nonce is single-use and expires after 10 minutes.
  - Manifest hash = `hashJson(the exact object you POSTed)`. I store the original, not the zod-parsed copy, so compute `hashJson()` on the same object you send.
  - Next: A1 contracts (Registry, Passport, AttestedEscrow, RentalEscrow + tests), deploy v1 to testnet, then D1 indexer.
- 2026-09-28 — Merged main with Laptop 2's B0 schemas into `lap1`: shared + schema tests 7/7 pass, typecheck clean. **All of CLAUDE2's requested shapes are accepted, and I'm building them in D0 now:**
  - `db.query<T>(sql, params?) => T[]` and `db.run(sql, params?)`, both synchronous better-sqlite3 wrappers exported as `Db` from `src/db/`.
  - Laptop 2's code may write to the `reports` and `jobs` tables.
  - `ChainClients = { provider: JsonRpcProvider; attestor: Wallet; chainId: number }` (ethers v6) in `src/chain/`.
  - `IndexerEvents` is an `EventEmitter` with `on("event", (e: IndexedEvent) => void)`. Backfill reads the `events` table through `db.query`.
  - `POST /evidence` calls `checkEvidence(file, meta, { db, receivedAt: Date.now(), location })`.
  - The `/ai/*` routes return the `run*` results as JSON.
  - `LLMOutputError` maps to 502 and `code = "NOT_FOUND"` maps to 404.
  - Until `ai/index.ts` lands, `server.ts` loads the AI module dynamically and returns 503 if it's missing, so main keeps building.
- 2026-09-28 — **A0 merged to main.**
  - Appendix A interfaces are copied verbatim into `contracts/interfaces/` and compile. `pnpm --filter @nestledger/contracts compile` now also exports the ABIs to shared.
  - Shared helpers are done, with tests.
  - Import schemas as `@nestledger/shared/schemas`. The package.json `exports` field points that at `src/schemas/index.ts`, so please create that file.
  - Shared `index.ts` still re-exports the Vibe Kit `deployments`, only because `frontend/src/hooks/useHello.ts` uses it. Delete useHello and tell me; I'll then remove the re-export.
  - The frontend tsconfig targets ES2017, so bigint literals like `10n` fail the Next build. Use `BigInt(...)`, or raise the target to ES2020 in your tsconfig.
  - Next for me: D0 backend skeleton, then A1 contracts.
- 2026-09-28 — Repo scaffolded from the Vibe Kit, restructured to SPEC §4.3, docs pushed. Next: A0 (shared package + Appendix A interfaces + ABIs), then D0 (server skeleton).
