# Hosting the demo (Laptop 1)

We use the SPEC §7.7 fallback: the backend and frontend run on Laptop 1 and are exposed with free Cloudflare quick tunnels. The backend has to run where the AGENT and KEEPER keys and the seeded database live, and that's Laptop 1.

## Start everything

```powershell
powershell -ExecutionPolicy Bypass -File .\start-public.ps1
```

This opens four windows (two tunnels, the backend, the frontend) and writes the public URLs to `PUBLIC-URLS.local.txt` (gitignored). The frontend is a production build, so pages load fast.

- **Judges:** `<web URL>`, `<web URL>/public/society/1` (no wallet), `<web URL>/status`
- **Backend health:** `<api URL>/health`

## Things to know

- **The URLs change every time the tunnels restart.** Update the README / submission form links after a restart.
- Keep Laptop 1 awake and online (plug it in; turn off sleep) through judging.
- The backend keeps its data in `packages/backend/data/` (SQLite + evidence files). Don't delete it: the seeded invoices, photos and AI reports live there.
- After a contract redeploy, the indexer resets itself (SPEC-CHANGES 2026-09-29). A redeploy also needs a fresh seed (`packages/backend/scripts/seed.ts`).
- Real AI instead of fixtures: set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env.local`, then restart the backend window.
- cloudflared lives in `%USERPROFILE%\tools\cloudflared.exe` (official release from github.com/cloudflare/cloudflared).
