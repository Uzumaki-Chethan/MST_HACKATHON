# CLAUDE1 — Laptop 1 (WP-A contracts + WP-D backend / keeper / IoT / demo ops)

Owned and edited only by the Laptop 1 Claude session. Laptop 2: read this after every merge; do not edit it.

## Who I am
- Branch `lap1`. Work packages WP-A and WP-D (SPEC §10.1).
- I own: `packages/contracts/**`, `packages/shared/**` except `src/schemas/`, `packages/backend/**` except `src/ai/` and `src/agent/`, `firmware/**`, `README.md`, `docs/demo-script.md`.

## My approach
- Contracts: Hardhat from the MST Vibe Kit, Solidity 0.8.24, `viaIR`, OpenZeppelin 5.0. Appendix A interfaces go in first, verbatim. `scripts/deploy.ts` writes `packages/shared/src/addresses.ts` (keyed `{31337, 91562037}`) and `packages/shared/src/abis/*.json`.
- Shared: `chain.ts` (exact from §4.4), `money.ts`, `hash.ts` (`hashJson` = keccak256 of RFC 8785 canonical JSON), `enums.ts`, `time.ts`, `inspection.ts`, `index.ts`.
- Backend: one Fastify process (ESM, run with `tsx`) that starts the HTTP server, indexer, keeper, and calls `startAgent()` from `src/agent/index.ts` (Laptop 2's code).

## What I provide for Laptop 2 (the contract between us)
| Thing | Where | Status |
|---|---|---|
| Chain, money, hash helpers | `@nestledger/shared` | pending |
| ABIs + addresses | `@nestledger/shared` (`abis/`, `addresses.ts`) | pending |
| `IndexedEvent` type + `IndexerEvents` emitter | `packages/backend/src/indexer/types.ts` | pending |
| `db.query` helpers + `Db` type | `packages/backend/src/db/` | pending |
| `ChainClients` (provider + attestor wallet) | `packages/backend/src/chain/` | pending |
| Upload route calls `checkEvidence()` | `packages/backend/src/ai/integrity.ts` (Laptop 2 writes it) | pending |
| `/ai/*` routes call Laptop 2's task functions | `packages/backend/src/ai/` | pending |

## What I expect from Laptop 2
- zod schemas for every Appendix B manifest/report in `packages/shared/src/schemas/`, exported from `schemas/index.ts`. `POST /manifests` validates against them.
- `startAgent(deps)` in `src/agent/index.ts`, `checkEvidence(file, meta, ctx)` in `src/ai/integrity.ts`, and one exported function per AI task for the `/ai/*` routes. Please write the exact function signatures into CLAUDE2.md.

## Sync log (newest first)
- 2026-09-28 — Repo scaffolded from the Vibe Kit, restructured to SPEC §4.3, docs pushed. Next: A0 (shared package + Appendix A interfaces + ABIs), then D0 (server skeleton).
