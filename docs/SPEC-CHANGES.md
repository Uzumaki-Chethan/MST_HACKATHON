# SPEC changes

Every deviation from docs/SPEC.md: date, what, why. Append only.

- **2026-09-28 — Scaffold from MST Vibe Kit 0.1.1 (`create-mst-app --template blank`).** Kept its turbo.json, workspace scripts, `scripts/deploy.ts` / `verify.ts` and hardhat networks (`testnet` = 91562037). Restructured to §4.3: frontend moved under `src/`, shared renamed `@nestledger/shared`, backend and firmware folders added. Hardhat bumped to solidity 0.8.24 with `viaIR: true` (§5.1). `Hello.sol` / `useHello.ts` are Vibe Kit samples that WP-A / WP-C will delete.
- **2026-09-28 — Env file location.** The Vibe Kit's hardhat.config reads secrets from the repo-root `.env.local`, not `packages/contracts/.env.local` (§5.10). One root `.env.local` holds all keys; `.env.example` lists every variable.
- **2026-09-28 — 2 laptops instead of 4 people.** See docs/WORK-SPLIT.md. Branches are `lap1` / `lap2` instead of `wp-a..wp-d`.
- **2026-09-28 — Per-laptop notes files.** Root `CLAUDE.md` keeps only the shared rules (Claude Code auto-loads only that name). Laptop-specific approach and sync logs live in `CLAUDE1.md` (Laptop 1) and `CLAUDE2.md` (Laptop 2).
