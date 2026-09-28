# NestLedger — context for Claude Code

Read `docs/SPEC.md` before doing anything. It is the single source of truth.

NestLedger is a hackathon project (MST Blockchain × Newrro Buildathon, 28–29 Sep 2026): smart-contract
escrow on MST Testnet for rent deposits (DepositLock), society funds (SocietyLedger) and renovation
milestones (BuildSafe), with an AI attestor agent, arbiter disputes, a soulbound reputation passport,
and an IoT water-tanker sensor (TankerTrust).

## Hard rules
- All code is written during the event in this repo. Never paste code from other projects.
- Use names EXACTLY as in the spec: contracts, functions, events, errors, endpoints, JSON schemas, files.
- Stay inside your work package's folders (SPEC §10.1). Never hand-edit packages/shared/src/abis or addresses.ts.
- Simple, readable code. No abstractions the spec doesn't need.
- Contracts: every function gets tests (SPEC §5.11); run `pnpm --filter contracts test` before committing.
- On-chain amounts are wei of native tMSTC. Show INR only through shared money helpers, labelled "demo rate".
- Anything simulated or scripted must be labelled in the UI.
- Never commit secrets. Use .env.local files.
- Commit after each completed task, prefix: contracts:/ai:/web:/api:/iot:/docs:
- If you must deviate from the spec, append the decision to docs/SPEC-CHANGES.md (date, what, why) and tell the human.

## Chain
MST Testnet · chainId 91562037 · RPC https://testnetrpc.mstblockchain.com · explorer https://testnet.mstscan.com · native tMSTC

## Layout
packages/contracts (Hardhat) · packages/shared (@nestledger/shared) · packages/backend (Fastify) ·
packages/frontend (Next.js) · firmware/tanker-sensor (PlatformIO)

## Two-laptop setup (read docs/WORK-SPLIT.md)
Two Claude Code sessions build this in parallel. Find out which laptop you are on (ask the human if unsure) and stay in that laptop's folders.
- **Laptop 1 — WP-A + WP-D:** packages/contracts/**, packages/shared/** (except src/schemas), packages/backend/** (except src/ai, src/agent), firmware/**, README.md, docs/demo-script.md. Branch `lap1`.
- **Laptop 2 — WP-B + WP-C:** packages/frontend/**, packages/backend/src/ai/**, packages/backend/src/agent/**, packages/shared/src/schemas/**. Branch `lap2`.
- Sync: `git fetch && git merge origin/main` before starting each task; merge your branch into main at every sync point in docs/WORK-SPLIT.md. If pnpm-lock.yaml conflicts, take main's copy and rerun `pnpm install`.
