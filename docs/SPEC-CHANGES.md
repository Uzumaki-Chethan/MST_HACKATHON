# SPEC changes

Every deviation from docs/SPEC.md: date, what, why. Append only.

- **2026-09-28 — Scaffold from MST Vibe Kit 0.1.1 (`create-mst-app --template blank`).** Kept its turbo.json, workspace scripts, `scripts/deploy.ts` / `verify.ts` and hardhat networks (`testnet` = 91562037). Restructured to §4.3: frontend moved under `src/`, shared renamed `@nestledger/shared`, backend and firmware folders added. Hardhat bumped to solidity 0.8.24 with `viaIR: true` (§5.1). `Hello.sol` / `useHello.ts` are Vibe Kit samples that WP-A / WP-C will delete.
- **2026-09-28 — Env file location.** The Vibe Kit's hardhat.config reads secrets from the repo-root `.env.local`, not `packages/contracts/.env.local` (§5.10). One root `.env.local` holds all keys; `.env.example` lists every variable.
- **2026-09-28 — 2 laptops instead of 4 people.** See docs/WORK-SPLIT.md. Branches are `lap1` / `lap2` instead of `wp-a..wp-d`.
- **2026-09-28 — Per-laptop notes files.** Root `CLAUDE.md` keeps only the shared rules (Claude Code auto-loads only that name). Laptop-specific approach and sync logs live in `CLAUDE1.md` (Laptop 1) and `CLAUDE2.md` (Laptop 2).
- **2026-09-28 — Manifest access without a context (Laptop 1).** §7.6 only defines lease/project/proposal/society/order contexts. Manifests that carry no context id (lease terms, project/milestone specs, notes, profiles) are readable by their uploader and by any signed-in user. They hold no photos, and their hashes are already on-chain.
- **2026-09-28 — `@nestledger/shared` is `"type": "module"` (Laptop 1).** Required so the backend (tsx, ESM) can import its re-exports at runtime.
