# Work split — 2 laptops, 2 Claude Code sessions

The spec (docs/SPEC.md §10) plans for 4 people. We run it with 2 laptops, each with its own Claude Code session and 2 work packages.

| Laptop | Work packages | Branch | Folders owned (only you edit these) |
|---|---|---|---|
| **Laptop 1** | **WP-A** contracts & chain ops, **WP-D** backend server / indexer / keeper / IoT / demo ops | `lap1/<module>` | `packages/contracts/**`, `packages/shared/**` (except `src/schemas/`), `packages/backend/**` (except `src/ai/`, `src/agent/`), `firmware/**`, `README.md`, `docs/demo-script.md` |
| **Laptop 2** | **WP-C** frontend, **WP-B** AI attestor agent | `lap2/<module>` | `packages/frontend/**`, `packages/backend/src/ai/**`, `packages/backend/src/agent/**`, `packages/shared/src/schemas/**` |

Each laptop keeps its own notes file: Laptop 1 → `CLAUDE1.md`, Laptop 2 → `CLAUDE2.md`. Read the other one after every merge.

Shared files that both laptops may touch: `docs/SPEC-CHANGES.md` (only append) and `pnpm-lock.yaml` (if it conflicts, take main's copy and rerun `pnpm install`).
`packages/backend/package.json` already lists the dependencies from SPEC §4.2 for both WP-B and WP-D, so neither laptop should need to edit it. If you do need to, append only and say so in chat.

## Why this split
- Laptop 1 holds the critical path (contracts → ABIs → indexer/keeper). It also owns the backend process that WP-B's agent plugs into.
- Laptop 2 holds everything user-facing plus the AI tasks. Early on it needs no ABIs: WP-B runs on `LLM_PROVIDER=fixtures` and WP-C sets up wallet, SIWE and layout.

## Order of work

### Laptop 1
1. **A0 (first 45 min, unblocks laptop 2):** `packages/shared` (`chain.ts` exact per §4.4, `money.ts`, `hash.ts`, `enums.ts`, `time.ts`, `inspection.ts`, `index.ts`). Commit Appendix A interfaces to `contracts/interfaces/`, compile, export ABIs to `shared/src/abis/`. **Merge to main and tell laptop 2.**
2. D0: Fastify skeleton, config, SQLite schema, SIWE, `POST/GET /evidence`, `POST/GET /manifests`, `/health`. Export `IndexedEvent` type (`src/indexer/types.ts`) and the `db.query` helpers WP-B needs early.
3. A1: Registry, Passport, AttestedEscrow, RentalEscrow and tests, then deploy v1 to testnet.
4. D1: indexer, `/timeline`, `/public/*`, `/me/*`, gas drip, then D2: keeper, capture sessions.
5. A2 → A3 → A4 (DisputeResolver, MilestoneEscrow, SocietyLedger, TankerTrust, deploy v2, verify, seed); D3 IoT / simulator.

### Laptop 2
1. B0: `VisionLLM` adapter (anthropic / gemini / fixtures), zod schemas for all of Appendix B in `shared/src/schemas/`. **Merge the schemas early**, because laptop 1's `POST /manifests` validates against them.
2. C0: wagmi + MST testnet chain, Connect BridgeKey, network guard, SIWE login, layout, `useTx`, `<Amount>`, `<Countdown>`, `<TxLink>`, `<StatusChip>`.
3. B1: `moveIn` / `moveOut` tasks, `checkEvidence`. C1: `/onboard`, `/dashboard`, `/rent/new`, `/rent/[id]`.
4. B2: agent loop + rental attest (needs laptop 1's indexer). C2: capture wizard, move-out, claim builder, respond, arbiter.
5. B3: milestone + invoice tasks, fixtures. C3: build, society, public dashboard, passport, status.

## Sync points (checkpoints the finished modules must reach on `main`)
| When | What must be on main |
|---|---|
| ~20:00 (IC1) | Laptop 1: shared + ABIs. Laptop 2: Appendix B schemas, frontend connects BridgeKey |
| Every ~2 h | Whatever is green. Never merge a broken build |
| 21:45 (IC2) | Real lease on testnet; AI move-in report in UI; evidence upload |
| 02:00 (IC3) | Full rental flow with agent attest + keeper + dispute |
| 07:30 (IC4) | All modules on testnet v2 + deployed URLs |

## Branch-per-module workflow (both laptops, from 2026-09-28 ~23:00)

`main` only ever receives **finished, tested modules**. Every module gets its own short-lived branch cut from the latest `main`. The old long-lived `lap1` / `lap2` branches are retired.

### Module branches
| Laptop 1 | Laptop 2 |
|---|---|
| `lap1/a1-core-rental`: Registry, Passport, AttestedEscrow, RentalEscrow + tests, testnet v1 | `lap2/b2-agent`: agent loop + rental attest (needs D1) |
| `lap1/d1-indexer`: indexer, `/timeline`, `/public/*`, `/me/*`, `/gas/drip` | `lap2/c2-rental-disputes`: move-out, claim builder, tenant response, arbiter pages |
| `lap1/d2-keeper`: keeper, capture sessions | `lap2/b3-milestone-invoice`: milestone + invoice AI tasks, fixtures |
| `lap1/a2-dispute-milestone`: DisputeResolver, MilestoneEscrow | `lap2/c3-build-society-public`: build, society, public dashboard, passport, status |
| `lap1/a3-society-tanker`: SocietyLedger, TankerTrust | |
| `lap1/a4-deploy-seed`: testnet v2, verify, seed, actors | |
| `lap1/d3-iot`: IoT firmware / simulator | |

### 1. Start a module
```bash
git checkout main && git pull origin main      # get the other laptop's finished modules
pnpm install
git checkout -b lap1/<module>                   # Laptop 2: lap2/<module>
```
Then re-read the other laptop's CLAUDE file (CLAUDE1.md / CLAUDE2.md) for anything that affects you.

### 2. While working
- Commit every 30–60 min with the usual prefixes, and `git push -u origin lap1/<module>` so the work is backed up.
- If you need something the other laptop just merged, run `git fetch origin && git merge origin/main` inside your module branch. Never merge a half-done module into main.

### 3. Finish a module (merge to main)
```bash
git fetch origin && git merge origin/main       # update your branch first; resolve conflicts here, not on main
pnpm install
pnpm --filter @nestledger/contracts test        # all four checks must pass
pnpm --filter @nestledger/backend test
pnpm --filter @nestledger/backend typecheck
pnpm --filter @nestledger/frontend build
git checkout main && git pull origin main
git merge --no-ff lap1/<module> -m "merge: lap1/<module>"
git push origin main
```
Then add a line to your CLAUDE file's sync log (what landed, and anything the other laptop must do), commit it on main and push.
If a check fails because of the **other** laptop's code, don't edit their folder. Note it in your CLAUDE file and tell the human.

### Conflicts
- `docs/SPEC-CHANGES.md`: keep both sides (it is append-only).
- `pnpm-lock.yaml`: take main's copy, then run `pnpm install`.
- Anything else means someone edited outside their folders. Stop and tell the human.
