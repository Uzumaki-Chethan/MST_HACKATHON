# CLAUDE2 — Laptop 2 (WP-B AI attestor agent + WP-C frontend)

Owned and edited only by the Laptop 2 Claude session. Laptop 1: read this after every merge; do not edit it.

## Who I am
- Branch `lap2`. Work packages WP-B (AI attestor agent) and WP-C (frontend) (SPEC §10.1, docs/WORK-SPLIT.md).
- I own: `packages/frontend/**`, `packages/backend/src/ai/**`, `packages/backend/src/agent/**`, `packages/shared/src/schemas/**`, and this file. I only append to `docs/SPEC-CHANGES.md`.

## My approach

### Schemas (`packages/shared/src/schemas/`)
- One zod schema per Appendix B type, named `<Type>Schema` (e.g. `BundleSchema`, `MoveOutReportSchema`), with `z.infer` types exported under the Appendix B names (`Bundle`, `MoveOutReport`, …).
- Common pieces: `hex32` (`^0x[0-9a-f]{64}$`), `weiString` (decimal string), `isoDate`, `address`.
- Numbers the LLM produces are clamped, not rejected, where SPEC §6.7 says so (`confidence` 0–1, `matchScore` 0–100, quantity 0–1000).
- `schemas/index.ts` also exports `manifestSchemas` (map from the `schema` string to its zod schema) and `parseManifest(obj)`, which is what `POST /manifests` uses.
- Imported everywhere as `@nestledger/shared/schemas`. Merged to main first (B0).

### LLM adapter (`src/ai/llm.ts`, SPEC §6.2)
- `VisionLLM` interface exactly as §6.2. `createLLM()` switches on `LLM_PROVIDER`:
  - `anthropic`: `@anthropic-ai/sdk` Messages API, temperature 0, each image preceded by a `[label]` text block, "Respond with one JSON object only".
  - `gemini`: `@google/generative-ai` `generateContent`, `inlineData` parts, `responseMimeType: "application/json"`, temperature 0.
  - `fixtures`: returns `src/ai/fixtures/{task}.json`; `id = "fixtures"`, so every report says `"model": "fixtures"` and the UI shows the "AI: fixture mode" badge.
- Shared wrapper: strip code fences → JSON.parse → zod validate; on failure retry up to 2 times with the error appended, then throw `LLMOutputError`. 60 s timeout per call.
- Images go through `sharp`: EXIF rotate, long edge ≤ 1280 px, JPEG q80, ≤ 16 images per call (batched per room above that).
- Prompts in `src/ai/prompts/*.ts`, each starting with the verbatim §6.3 system prompt. `PROMPT_VERSION = "2026-09-28.1"`.

### AI tasks (`src/ai/tasks/*.ts`)
- "Numbers from code, words from the LLM" (§6.1): the LLM classifies and picks rate-card ids/quantities; code computes every ₹ amount, fraction, score cap and threshold (§6.3 code rules, §6.4 anomaly rules R1–R7).
- Each task loads the bundle manifest and files via the `Db` handle, runs, stores the report in the `reports` table (task, context, model, prompt_version) and returns `{report, reportHash}` with `reportHash = hashJson(report)`. A report is never regenerated for the same claim round.
- `checkEvidence` (`src/ai/integrity.ts`, §6.5): keccak dup, 64-bit pHash (`blockhash-core` on a `sharp` greyscale resize) against stored photos, freshness, EXIF (`exifr`), geofence (haversine ≤ 200 m). Never blocks an upload.

### Agent (`src/agent/`, SPEC §6.6, §6.8)
- `startAgent(deps)` subscribes to `deps.indexer.on("event", …)` and handles `RentalEscrow.ClaimSubmitted`, `MilestoneEscrow.ClaimSubmitted`, `SocietyLedger.ProposalCreated` (kind 0), then runs `backfill`.
- Builds the `nestledger.report.attestation.v1` wrapper, stores it, and posts `attest(...)` / `attestInvoice(...)`.
- One send queue at concurrency 1 on the attestor wallet, `staticCall` before every send, 1 confirmation, idempotency key `attest:{contract}:{id}:{idx}:{round}` in `jobs`, 3 retries with backoff.

### Frontend (`packages/frontend`, SPEC §8)
- wagmi v2 + viem + TanStack Query, `mstTestnet` from `@nestledger/shared` (no local chain copy). I keep the Vibe Kit's same-origin RPC proxy (`/api/rpc/testnet`) as the transport, because the MST RPC sends no CORS headers (will log in SPEC-CHANGES).
- "Connect BridgeKey": prefer the EIP-6963 provider whose name contains "BridgeKey", fall back to `window.ethereum`, otherwise show install links. Network guard: `wallet_switchEthereumChain` → on 4902 `wallet_addEthereumChain(addChainParams)`.
- SIWE: `/auth/nonce` → `personal_sign` → `/auth/verify`; JWT kept in memory + `sessionStorage`; `src/lib/api.ts` has typed wrappers for every §7.3 endpoint.
- Tailwind, light theme only: white background, slate text, accent teal `#0F766E`. Works at 390 px.
- Structure: `src/lib/` (wagmi, api, labels, auth), `src/hooks/` (`useNest`, `useTx`), `src/components/` (`Amount`, `Countdown`, `TxLink`, `StatusChip`, `RoleBadge`, `SimulatedBadge`, `ConnectBridgeKey`, `LiveCapture`), `src/app/` routes from §8.3.
- Amounts only through `formatMSTC` / `formatINR` / `formatAmount` from shared; bigints via `BigInt(...)` (or tsconfig target ES2020).
- Vibe Kit sample (`useHello.ts`, the Hello usage in `page.tsx`, `SdkWalletPanel`) is deleted when I replace the home page; I'll tell Laptop 1 so the `contracts.ts` re-export can go.

## What I provide for Laptop 1
All paths under `packages/backend/src/` unless noted. `Db`, `ChainClients`, `IndexerEvents`, `IndexedEvent` are Laptop 1's types.

| Export | Signature | Used by | Status |
|---|---|---|---|
| Schemas | `@nestledger/shared/schemas`: `BundleSchema`, `LeaseTermsSchema`, `RentalClaimSchema`, `MoveInReportSchema`, `MoveOutReportSchema`, `ProjectSpecSchema`, `MilestoneSpecSchema`, `MilestoneClaimSchema`, `MilestoneReportSchema`, `InvoiceDocSchema`, `InvoiceExtractionSchema`, `InvoiceReportSchema`, `NoteSchema`, `ProfileMetaSchema`, `SocietyMetaSchema`, `AttestationReportSchema`, plus types; `manifestSchemas: Record<string, ZodTypeAny>`; `parseManifest(obj: unknown): { schema: string; value: unknown }` (throws `ZodError` / unknown-schema `Error`) | `POST /manifests` | **done** (on main) |
| LLM factory | `ai/llm.ts`: `createLLM(): VisionLLM`, `interface VisionLLM` (§6.2), `class LLMOutputError` | `server.ts` (pass into `startAgent` and task deps) | pending (B0) |
| Integrity | `ai/integrity.ts`: `checkEvidence(file: Buffer, meta: EvidenceMeta, ctx: { db: Db; receivedAt: number; location: { lat: number; lng: number } \| null }): Promise<IntegrityResult>`; `IntegrityResult = { hash; phash: string \| null; duplicateOf?; reusedOf?; nearDuplicateOf?; fresh?: boolean; exifTime?: string \| null; stale?: boolean; geoOk: boolean \| null }`; `EvidenceMeta` = the §7.3 `meta` JSON | `POST /evidence` (store `phash` + result as `checks_json`) | pending (B1) |
| Move-in | `ai/tasks/moveIn.ts`: `runMoveIn(args: { leaseId: string; bundleHash: string }, deps: AiDeps): Promise<{ report: MoveInReport; reportHash: Hex32 }>` | `POST /ai/move-in` | pending (B1) |
| Move-out | `ai/tasks/moveOut.ts`: `runMoveOut(args: { leaseId: string; bundleHash: string }, deps: AiDeps): Promise<{ report: MoveOutReport; reportHash: Hex32 }>` | `POST /ai/move-out` | pending (B1) |
| Milestone preview | `ai/tasks/milestone.ts`: `runMilestonePreview(args: { projectId: string; milestoneIndex: number; bundleHash: string }, deps: AiDeps): Promise<{ report: MilestoneReport; reportHash: Hex32; supportedPreview: string[] }>` (wei strings per line item) | `POST /ai/milestone/preview` | pending (B3) |
| Invoice preview | `ai/tasks/invoice.ts`: `runInvoicePreview(args: { societyId: string; bundleHash: string; payee: string; amountWei: string }, deps: AiDeps): Promise<{ report: InvoiceReport; reportHash: Hex32 }>` | `POST /ai/invoice/preview` | pending (B3) |
| Task deps | `ai/index.ts`: `type AiDeps = { db: Db; llm: VisionLLM; chain: ChainClients }`; re-exports every function above | routes | pending (B0) |
| Agent | `agent/index.ts`: `startAgent(deps: { indexer: IndexerEvents; db: Db; chain: ChainClients; llm: VisionLLM }): void` (exact §6.8) | `server.ts` at startup | pending (B2) |

Errors: tasks throw `LLMOutputError` (→ 502/500) or `Error` with `code = "NOT_FOUND"` for a missing bundle/manifest (→ 404). Routes map them to the §7.3 error shape.

## What I need from Laptop 1
Response to CLAUDE1.md "What I provide for Laptop 2":

| Item | Response | Status |
|---|---|---|
| Shared chain/money/hash/enums/time/inspection | Received, using as-is. | ok |
| ABIs + addresses | Received; I'll use the typed `*Abi` exports and `addresses[chainId]`. Please tell me when testnet addresses land. | waiting on deploy |
| `IndexedEvent` + `IndexerEvents` (`indexer/types.ts`) | Need `IndexerEvents` to be an `EventEmitter` with `on("event", (e: IndexedEvent) => void)` exactly as §6.8. Also please expose a way to read past events for backfill, e.g. `db.query` on the `events` table is enough. | needed for B2 |
| `Db` + `db.query` helpers (`db/`) | I need a synchronous `db.query<T>(sql: string, params?: unknown[]): T[]` and `db.run(sql, params)` (thin better-sqlite3 wrappers), plus the evidence file path (the `evidence.path` column is fine). My tasks write to `reports` and `jobs`; OK? History for §6.4 (`paidInvoices`, `pendingProposals`) I'll write in `ai/history.ts` with raw SQL on `events` + `reports`. | needed for B1 |
| `ChainClients` (`chain/`) | Please shape it as `{ provider: JsonRpcProvider; attestor: Wallet; chainId: number }` (ethers v6), built from `RPC_URL` + `ATTESTOR_PRIVATE_KEY`. Contract instances I'll build myself from the shared ABIs + addresses. | needed for B2 |
| Upload route calls `checkEvidence()` | Signature in the table above. Please pass `receivedAt = Date.now()` and the society/project `location` if you know it (else `null`). | ok once B1 lands |
| `/ai/*` routes | Please call the `run*` functions above and return their result as JSON. | ok once B1 lands |
| `contracts.ts` re-export | I'll delete `useHello.ts`; then you can drop the Vibe Kit re-export from shared `index.ts`. | will notify |

## Notes for both laptops
- **Node 24 on Windows:** `better-sqlite3@11` has no prebuilt binary for Node 24 and `pnpm install` fails without a C++ toolchain. Workaround on Laptop 2: `npm_config_use_node_version=22.12.0 pnpm install` (pnpm fetches Node 22 for the install scripts). The backend must then also run on Node 22 (e.g. `pnpm --config.use-node-version=22.12.0 --filter @nestledger/backend dev`). Not changing any shared config for this.

## Sync log (newest first)
- 2026-09-28 — **B0 schemas merged to main.** `@nestledger/shared/schemas` exports every Appendix B schema (`BundleSchema` … `AttestationReportSchema`), their types, `manifestSchemas` and `parseManifest(obj)` for `POST /manifests`. Extra checks beyond the plain shapes: a rental claim needs item 0 = `unpaid_dues` and `items[i].index == i`; `ProfileMetaSchema` is strict (no extra personal fields); scores and confidence are bounded 0–100 / 0–1. Tests: `npx tsx --test src/schemas/schemas.test.ts` in packages/shared. Next: `VisionLLM` adapter (fixtures first), then C0.
- 2026-09-28 — **Laptop 2 moved to a different physical machine.** Fresh clone of `lap2` (identical to main, nothing lost), `pnpm install` OK on Node 20 here (no Node 22 workaround needed on this machine). Same branch, same plan, same folders. `gh` CLI isn't installed here, so merges to main use plain git. Now working on B0: schemas first, merged to main as soon as they typecheck.
- 2026-09-28 — Cloned, merged main (Laptop 1's A0) into `lap2`, `pnpm install` OK (with the Node 22 workaround above). Wrote this file. Next: B0 (schemas → merge to main early, then the `VisionLLM` adapter).
