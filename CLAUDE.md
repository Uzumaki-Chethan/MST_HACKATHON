# NestLedger — context for Claude Code

This file is the only one Claude Code loads automatically. Keep it short. Before doing anything, read:
1. `docs/SPEC.md`, the single source of truth.
2. `docs/WORK-SPLIT.md`, which says who owns which folders on the two laptops.
3. `CLAUDE1.md`, written by Laptop 1 (WP-A contracts + WP-D backend/IoT): its approach, the interfaces it exports, and its sync log.
4. `CLAUDE2.md`, written by Laptop 2 (WP-B AI agent + WP-C frontend): the same for Laptop 2.

**Only edit your own CLAUDE file** (Laptop 1 → CLAUDE1.md, Laptop 2 → CLAUDE2.md). After every merge from main, re-read the other laptop's file so you know its approach and what it changed.

NestLedger is a hackathon project (MST Blockchain × Newrro Buildathon, 28–29 Sep 2026): smart-contract escrow on MST Testnet for rent deposits (DepositLock), society funds (SocietyLedger) and renovation milestones (BuildSafe), with an AI attestor agent, arbiter disputes, a soulbound reputation passport, and an IoT water-tanker sensor (TankerTrust).

## Hard rules (both laptops)
- All code is written during the event in this repo. Never paste code from other projects.
- Use names EXACTLY as in the spec: contracts, functions, events, errors, endpoints, JSON schemas, files.
- Stay inside your laptop's folders (docs/WORK-SPLIT.md). Never hand-edit packages/shared/src/abis or addresses.ts.
- Simple, readable code. No abstractions the spec doesn't need.
- Contracts: every function gets tests (SPEC §5.11); run `pnpm --filter @nestledger/contracts test` before committing.
- On-chain amounts are wei of native tMSTC. Show INR only through shared money helpers, labelled "demo rate".
- Anything simulated or scripted must be labelled in the UI.
- Never commit secrets. Use the repo-root `.env.local` (see `.env.example`).
- Commit after each completed task, prefix: contracts:/ai:/web:/api:/iot:/docs:
- If you must deviate from the spec, append the decision to docs/SPEC-CHANGES.md (date, what, why) and tell the human.
- If pnpm-lock.yaml conflicts on merge, take main's copy and rerun `pnpm install`.

## Chain
MST Testnet · chainId 91562037 · RPC https://testnetrpc.mstblockchain.com · explorer https://testnet.mstscan.com · native tMSTC

## Layout
packages/contracts (Hardhat) · packages/shared (@nestledger/shared) · packages/backend (Fastify) ·
packages/frontend (Next.js, src/app) · firmware/tanker-sensor (PlatformIO)
