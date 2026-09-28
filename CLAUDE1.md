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
- 2026-09-29 — **NEW public URLs, `lap1/demo-actors` merged, and a full UI test of every demo flow (with 3 bugs for Laptop 2).**
  - **Frontend:** https://stack-bikes-invitation-arms.trycloudflare.com · **Backend:** https://lying-weekends-decent-born.trycloudflare.com. The venue Wi-Fi blocks QUIC, so the old tunnels died for good. `start-public.ps1` now uses `--protocol http2`, which reconnects by itself after Wi-Fi drops, and it stops stale tunnels first.
  - **Scripted actors:** `scripts/actors/arbiter-vote.ts` (ARB2/ARB3) and `committee-approve.ts` (C3/C4, waits for the AI attestation, and writes override notes when the proposal is flagged). Both sign in with SIWE and store a `note.v1` manifest, so rationales and override reasons show up in your UI.
  - **Backend fix:** `/public/societies/:id/ledger` `approvers[]` now leaves out approvals that a flagged `attestInvoice` wiped. The proposer's automatic approval used to show twice. If your public page lists approvers from the `Approved` events, apply the same rule: only count approvals after the last `InvoiceAttested` with `flagged: "true"`.
  - **UI test (Playwright + injected wallet, real txs on testnet):**
    - Every route loads logged out (desktop and Pixel) and as ASHA, ROHAN, ARB1, IMRAN and MEERA: no JS errors, no 5xx, no overflow.
    - Through the UI: arbiter vote, trust-priced lease (Tier 3 → deposit halved), sign + rent + move-in + move-out, greedy claim, milestone claim → keeper silence release, and the ₹4,800 bill (flag risk 80 → override approvals → keeper executes).
    - Dispute 2 was a real split decision (tile upheld, paint rejected).
  - **Demo invoice:** `docs/demo-assets/invoice-4800.jpg`.
- 2026-09-29 — **`lap1/docs-readme` merged: README.md (SPEC §12.2) and `docs/demo-script.md` (§11.3 without TankerTrust).**
  - The README covers: all 6 contracts with MSTScan links (all 6 checked **verified**), a table of 20 real txs by type (each checked against the indexer's events), the MST integration (chain, BridgeKey, Vibe Kit, and an honest note that we use ethers/viem instead of the MST SDK), the AI attestor and fixtures mode, security and privacy, the judge guide, setup, limitations and acknowledgements.
  - **Please check the README's BridgeKey and frontend descriptions** (connect, network guard, SIWE, `useTx`, the no-wallet pages) and tell me if anything is off.
  - The demo script names two scripted-actor helpers I'm writing next: `scripts/actors/arbiter-vote.ts` (ARB2) and `committee-approve.ts` (C3/C4, with override notes).
  - **Warning:** the frontend build check overwrites the build the public site serves. After it, restart the frontend with `NEXT_PUBLIC_API_URL` set (see `docs/HOSTING.md`). It's restarted now, and the URLs are unchanged.
- 2026-09-29 — **The public site is back up with NEW tunnel URLs** (the previous session's servers stopped when it closed). Use only these; the old frontend URL still loads but can't sign in or call the backend (its origin is no longer in CORS/SIWE).
  - **Frontend:** https://somebody-manufacture-back-olympus.trycloudflare.com (`/public/society/1`, `/status`)
  - **Backend:** https://phrases-considerable-marijuana-chess.trycloudflare.com (`/health`)
  - Checked live: all return 200, `/health` has `rpcOk: true`, indexer lag 0, `llm: fixtures`. `/public/societies/1` shows Green Meadows with a ₹11,950 balance and 6 flats. CORS allows the new frontend origin, and the frontend bundle has the new backend URL built in. Same seeded DB, same v2 addresses.
  - Next for me: README + `docs/demo-script.md` (`lap1/docs-readme`), then a full demo dry run with the human.
- 2026-09-29 — **The app is PUBLIC (Cloudflare quick tunnels from Laptop 1). `lap1/d4-indexer-reset` and `lap1/d5-hosting` are merged.**
  - **Frontend (production build, includes your public-page update and icon):** https://roommate-depending-sur-available.trycloudflare.com. Try `/public/society/1` and `/status`.
  - **Backend:** https://cursor-reserves-capable-ensuring.trycloudflare.com (`/health`). It holds the seeded DB, the AGENT and KEEPER keys, and runs the indexer + agent + keeper. CORS and SIWE accept the frontend tunnel origin and `http://localhost:3000`.
  - The tunnel URLs change whenever the tunnels restart. The human restarts everything with `start-public.ps1` (see `docs/HOSTING.md`), and the current URLs are written to `PUBLIC-URLS.local.txt` on Laptop 1.
  - **Your indexer point is fixed:** a `kv` fingerprint (addresses + DEPLOY_BLOCK). On the first poll after it changes, the backend clears events, cursor and jobs and re-indexes from the new DEPLOY_BLOCK; evidence, manifests and reports are kept.
  - **Your hosting point is covered:** the public backend *is* the one that ran the seed, so the invoice manifests resolve.
  - `PUBLIC_WEB_ORIGIN` may now be a comma-separated list (CORS + SIWE domains). The first entry is used in QR capture links, so `/capture-sessions` URLs point at the public frontend.
  - Please rerun your browser test against the public frontend URL above.
- 2026-09-29 — **A4 merged to main (`lap1/a4-deploy-seed`). Testnet v2 is LIVE, verified on MSTScan, and seeded.** All addresses are in `@nestledger/shared` `addresses[91562037]` (DEPLOY_BLOCK 5789828):
  - NestRegistry `0x53cdf6bfF53357f60c5eC9Dd4552f243837ec9f8` · NestPassport `0x7d8706C27ed1385E37a516Bd1094Fc0e4a3B8002`
  - DisputeResolver `0x7868AcEb5f4d043476793086198870d90Bfe78d4` · SocietyLedger `0xb19d9d63A50b14C35c3DFFF9e5b8C8E7C6923377`
  - RentalEscrow `0xEF1ed68f299B47d78719b4a7a635E7e610753629` · MilestoneEscrow `0x20feF97Dae8b896f7ca08740Fb176D1b32a1846a`
  - Wiring: MODULE_ROLE to resolver, ledger, rental and milestone; `ledger.setModules(rental, milestone, 0x0)` (no tanker); ATTESTOR_ROLE to AGENT; arbiters ARB1–3; tier params 2; dispute bond 0.001; arbiter voting window 300 s.
  - **Seeded state (SPEC §11.2), all real txs, run by `packages/backend/scripts/seed.ts`:**
    - **Society 1, "Green Meadows Residency".** Committee MEERA, ROHAN, C3, C4, C5, threshold 3. Tier limits ₹10,000 / ₹50,000, quorum 30%, votingPeriod 120 s, attestTimeout 60 s.
    - Flats: A-101 PRIYA, B-304 ROHAN, C-202 MEERA, D-101 C3, D-102 C4, D-103 C5, weight 10 each, ₹2,000 maintenance; every owner paid once.
    - **Plumbing history:** proposals 1–3 are PayVendor to PLUMBER for ₹1,200 / ₹1,500 / ₹1,350. Each has a generated invoice image (fictional vendor) and an invoice.v1 manifest, and each was attested clean by your agent (risk 0) and executed by the keeper. **The live ₹4,800 bill is NOT seeded**: it's the live demo beat (it'll be proposal 4).
    - **Lease 1** (ROHAN → ASHA, B-304, rent ₹30,000, deposit ₹1,80,000, demo windows) is Active. Both periods are paid on time, ASHA's move-in baseline is 4 demo photos plus a move-in report from `/ai/move-in`, and the keeper presumed it accepted. ASHA's passport is **Tier 2, score 520, 2 on-time, 0 late**; closing this lease with no lost dispute takes her to Tier 3. The demo continues from **move-out**.
    - **Project 1** (ROHAN → IMRAN, "Kitchen renovation, B-304"): 3 milestones (Demolition ₹20k, Civil + electrical ₹40k, Finishing ₹30k, 30% advances), each with a milestone-spec.v1 (2 vantage points + reference images). IMRAN accepted, milestone 0 was claimed with a `/ai/milestone/preview` report, your agent attested it, and ROHAN approved. **Milestone 1 is Open** for the live demo beat.
  - Public API checked live: `/public/societies/1` shows balance ₹11,950 (₹16,000 collected, ₹4,050 spent), 6/6 flats paid this month, and `/ledger` has 11 items with invoice files. The first v2 deploy was replaced (see SPEC-CHANGES) after a seed-ordering bug recorded a permanent late payment for ASHA.
  - **The backend (agent + keeper + indexer) is running on Laptop 1** against these addresses. Please test every page against v2 now.
  - Next for me: README (contract + tx-hash tables, judge guide), `docs/demo-script.md`, hosting the backend, then a full dry run of the demo with the human.
- 2026-09-29 — **A3 merged to main (`lap1/a3-society-tanker`).** SocietyLedger and the public society API are done; 61 contract tests pass. **TankerTrust and IoT are dropped by team decision** (SPEC-CHANGES): no `/iot` page and no Water tab. A `TankerOrder` proposal reverts `BadInput`. The build is now 7 contracts.
  - **Not on testnet yet.** `lap1/a4-deploy-seed` comes next and deploys all 7 at once. `addresses[31337]` holds a full local deploy. `deploy.ts --network localhost` now works with no env vars: attestor and arbiters fall back to hardhat accounts #1–#4.
  - **SocietyLedger behaviour you'll build against:**
    - `propose` auto-approves for the proposer (approvals = 1), so a tier-0 proposal with threshold 1 can execute right after attestation or `attestTimeout`.
    - Tier = the vendor's month-to-date committed spend including this proposal (`vendorMonthCommitted(societyId, vendor, month)`, where `month = floor(ts / 30 days)`). `WorkDecision` is always at least tier 1.
    - `attestInvoice(…, flagged=true)` resets approvals to 0 and bumps the epoch (`hasApproved` goes false). After that, **every** `approve` needs a non-zero `overrideReasonHash` (a note.v1 manifest).
    - Tier 2: when approvals reach the threshold the status becomes `CommitteeApproved` and `voteEnds` is set. `castVote(id, flatId, support)` is cast by the flat's delegate if one is set, otherwise the owner. After `voteEnds`, `execute` pays if quorum and majority hold, otherwise it sets `Rejected` (the keeper does this).
    - `canExecute(id)` returns one of these reason strings: `"not open"`, `"awaiting AI attestation"`, `"needs more committee approvals"`, `"resident vote still open"`, `"resident quorum not met"`, `"residents voted against"`.
    - `FundWork` data is `abi.encode(ProjectInput, MilestoneInput[])`. `payee` must equal `contractor` and `amount` must equal Σ line items; `resultRef` = the new projectId, whose payer is the ledger and `payerRef` = societyId.
    - `WorkDecision` data is `abi.encode(uint256 projectId, uint8 action, uint16 mask, bytes32 reasonHash)`, with action 0 accept, 1 dispute (amount = the dispute bond) or 2 rework (amount 0 for accept and rework). Refunds from society projects arrive as `Deposited(societyId, milestoneEscrow, amount)`.
    - Views: `getSociety`, `getFlat`, `getProposal`, `flatsOf`, `proposalsOf`, `societiesOf(member)` (admin or committee), `isCommittee`, `hasApproved`, `hasVoted`, `effectiveTier`, `requiredApprovals`, `availableBalance`, `flatInfo`.
  - **`GET /public/societies/:id`** (no login, cached 5 s). Amounts are decimal wei strings; addresses are lowercase.
    ```
    { societyId, name, admin, metaHash, meta: <society.v1 manifest JSON> | null, contract, explorerUrl,
      committee: string[],
      config: { threshold, tier1LimitWei, tier2LimitWei, quorumBps, votingPeriod, attestTimeout },
      totals: { balanceWei, committedWei, availableWei, totalCollectedWei, totalSpentWei, collectedThisMonthWei, spentThisMonthWei },
      monthly: [{ month: "2026-09", collectedWei, spentWei }]      // last 6 calendar months, oldest first
      spendByCategory: [{ category, spentWei }],
      flats: [{ flatId, label, weight, maintenanceWei, totalPaidWei, lastPaidAt, paidThisMonth }],
      openProposals: [{ proposalId, kind: "PayVendor"|"FundWork"|"WorkDecision"|"TankerOrder", status: "Pending"|"CommitteeApproved",
        payee, amountWei, category, docHash, tier, effectiveTier, approvals, requiredApprovals, attested, flagged, riskScore,
        reportHash, justification: string|null, createdAt, voteEnds, votesFor, votesAgainst, totalWeight, quorumBps, canExecute, reason }],
      updatedAt }
    ```
    It returns 404 for an unknown society and 503 before SocietyLedger is deployed.
  - **`GET /public/societies/:id/ledger?cursor=`**, newest first, 25 per page. Pass `nextCursor` back as `cursor`; `null` means the end.
    ```
    { items: [
        { id, direction: "in", type: "maintenance", amountWei, from, flatId, flatLabel, txHash, blockNumber, timestamp }
      | { id, direction: "in", type: "deposit", amountWei, from, txHash, blockNumber, timestamp }
      | { id, direction: "out", type: "PayVendor"|"FundWork"|"WorkDecision"|"TankerOrder", amountWei, payee, proposalId,
          category, docHash, invoiceFiles: string[] /* invoice.v1 files, open with GET /evidence/:hash */,
          reportHash|null, riskScore, flagged, justification|null,
          approvers: [{ member, overrideReasonHash|null, overrideText|null }], resultRef, txHash, blockNumber, timestamp } ],
      nextCursor: string | null }
    ```
    `overrideText` is read from the note.v1 manifest you POSTed. `justification` comes from the stored invoice report.
  - Next for me: `lap1/a4-deploy-seed`, which deploys all 7 contracts to testnet (v2), verifies them, and seeds per SPEC §11.2 with your invoice rules.
- 2026-09-29 — **A2 merged to main (`lap1/a2-dispute-milestone`).** DisputeResolver and MilestoneEscrow are written and tested (**50 contract tests**). They are **not on testnet yet**: all 8 contracts go up together in the v2 redeploy after A3.
  - The shared ABIs for `milestoneEscrowAbi` and `disputeResolverAbi` are now the implementation ABIs. Build your C3b pages against them.
  - `addresses[31337]` has a local deploy with all 5 contracts so far, including MilestoneEscrow + DisputeResolver, for local UI work (`hardhat node` + `deploy.ts --network localhost`).
  - **DisputeResolver** (§5.7): a pool of 3 demo arbiters (ARB1–3) plus admin `addArbiter`. Panels are picked round-robin and skip the payer and payee. `vote(id, upheldMask, rationaleHash)`: an item is decided when 2 votes agree, and when every disputed item is decided the escrow pays out in the **same tx**. The bond goes back to the disputer if the payee got less than half of the disputed value, otherwise it is split among the arbiters who voted. `replaceArbiter` is admin-only, after `voteDeadline`, for slots that haven't voted. Views: `getDispute`, `disputesOf(arbiter)`, `disputeFor(escrow, id, idx)`, `arbiterPool`. Demo `votingWindow` is 300 s, bond 0.001.
  - **MilestoneEscrow** (§5.6):
    - `createProject(p, ms)` must be funded with exactly Σ line items. `acceptProject` pays milestone 0's advance. `respond(0)` pays the rest and **opens the next milestone, paying its advance in the same tx**.
    - `requestRework(id, mask, reasonHash)` → round+1, the tranche is Open again, and `claimDeadline = now + reworkWindow`.
    - Silence releases backed items only if `score ≥ minScore`.
    - Stall: after the deadline, **only the payer** can call `finalizeNoClaim`. That refunds the current milestone minus its advance plus all future milestones, and marks the contractor abandoned.
    - Late claims are allowed and recorded (`ClaimSubmitted.late`).
    - Change orders: `proposeChangeOrder(id, target, m, reasonHash)` accepts `target` = an unopened future index (modify) or `trancheCount` (append). The payer sends the increase up front when they propose; the payer funds on approval when the contractor proposes; decreases are refunded on approve. `rejectChangeOrder` is the counterparty rejecting or the proposer withdrawing. A change order that went stale (its slot was changed first) reverts `BadStatus` on approve.
  - Next for me: `lap1/a3-society-tanker` (SocietyLedger + TankerTrust + `/public/societies/*`), then `lap1/a4-deploy-seed` (full v2 on testnet, verify, seed with your invoice rules).
- 2026-09-29 — **D2 merged to main (`lap1/d2-keeper`).** The keeper and capture sessions are done. The backend process now runs API + indexer + agent + keeper.
  - **Keeper (SPEC §7.5):** every 15 s it finalises presumed baselines, refunds unclaimed deposits (`finalizeNoClaim`), finalises silence on rental and milestone claims, executes ready society proposals (including ones whose tier-2 vote ended), and expires late tanker orders. It dry-runs with `staticCall`, sends serially from KEEPER, records `jobs` rows (`keeper:<fn>:<key>`), and uses **chain time**. It never cancels stalled milestones.
  - **Live proof on testnet:** smoke lease **#1** (ROHAN → ASHA, 0.01 tMSTC deposit, via `scripts/actors/smoke-baseline.ts`). ASHA submitted a baseline, ROHAN stayed silent, and the keeper called `finalizeBaseline(1)` on its own: https://testnet.mstscan.com/tx/0x815a0dec917efef71743bcb7f4a7741bae0db56cf2db3b6004721b0a27d1c669. So lease 1 on v1 is Active with baseline PresumedAccepted. Your `/rent/1` page should show that history. Its rent is 0.001 per period, so ASHA can pay the 2 periods and move out to test C2 end to end.
  - **Capture sessions (§8.4 QR handoff):**
    - `POST /capture-sessions {context:{type,id}, stage, template}` → `{token, url}`, where url = `${PUBLIC_WEB_ORIGIN}/capture/<token>`. Valid for 30 min.
    - The phone calls `POST /evidence` with header **`X-Capture-Token: <token>`** instead of a JWT. The upload's `meta.context` must match the session's, or it gets 403; an expired or bogus token gets 401.
    - `GET /capture-sessions/:token` (creator JWT) → `{context, stage, template, expiresAt, uploads:[{hash, room, vantageId, checks}]}`.
  - Backend tests: 45/45, including yours.
  - **The AGENT key lives only here**, so the agent attests only while this laptop's backend runs. Hosting it (Render/Railway) is on my list after A2/A3.
  - Next for me: `lap1/a2-dispute-milestone` (DisputeResolver + MilestoneEscrow), then `lap1/a3-society-tanker` (incl. `/public/societies/*`), then the v2 redeploy + seed with your invoice rules (₹1,200 / ₹1,500 / ₹1,350 history + ₹4,800 live, images, ATTESTOR_ROLE to AGENT).
- 2026-09-28 — **D1 merged to main (`lap1/d1-indexer`).** The indexer is live, and the backend now runs indexer + agent + API in one process (`pnpm --filter @nestledger/backend start`).
  - **Your B2 agent is wired:** `main()` calls `startAgent({ indexer: indexer.events, … })` *before* `indexer.start()`, so no event is missed. Live check against testnet: the indexer caught up on all 50 events since `DEPLOY_BLOCK` (lag 2 blocks), and your agent logged `started; attestor 0xe0f0…064b, model fixtures`.
  - **Event rows, exactly as you asked:** `contract` is the `ContractName` (`"RentalEscrow"` …), `name` is the ABI event name, and `args_json` holds every event arg by its ABI name. Encoding: bigints and enums as decimal strings, bools as `"true"`/`"false"`, **addresses lowercase**, arrays as `string[]`. `k1` is the first of leaseId / id / proposalId / orderId / disputeId / flatId / societyId / user / holder …; `k2` is idx / trancheIdx / coId / periodIndex / societyId / agreementId. A test decodes a real `ClaimSubmitted` log and checks `{id:"7", idx:"0", round:"0", items:["0","450000000000000"], evidenceHash, late:"false"}`.
  - **New endpoints (§7.3 shapes):**
    - `GET /timeline/:contract/:id`, where contract is rental / milestone / ledger / tanker / dispute. Each item is `{contract, name, args, txHash, blockNumber, timestamp}` (I added `contract`).
    - `GET /me/flats` returns `[{flatId, societyId, label, maintenanceWei}]` (empty until SocietyLedger exists).
    - `GET /me/feed` (P1) and `GET /public/passport/:address`, which returns `{address, hasPassport, verified, kinds, registeredAt, tier, score, stats:{RentOnTime…}, recent:[timeline items]}`.
    - `POST /gas/drip` sends 0.02 tMSTC once per registered wallet. It returns `{txHash}`, or 409 if already dripped, 403 if not registered and 503 if the registry isn't deployed.
  - `/public/societies/*` lands with `lap1/a3-society-tanker`, once SocietyLedger exists.
  - Your two notes are covered: ATTESTOR_ROLE is already granted to AGENT on testnet, and `GET /manifests/:hash` + `GET /reports/:hash` use the same `canRead`, which includes the `disputeFor` arbiters, as `/evidence`.
  - Next for me: `lap1/d2-keeper` (keeper + capture sessions), then A2 (DisputeResolver, MilestoneEscrow).
- 2026-09-28 — **A1 merged to main (`lap1/a1-core-rental`). Contracts are LIVE on MST testnet (v1) and verified on MSTScan.**
  - NestRegistry `0x87d7eeDF89Aeec6551534F54b80D23911A30F2a5`, NestPassport `0xCaE95713df4206C3359409d489A5169b97bEb153`, RentalEscrow `0xe5608B1C26D8d3E05a0C1846eEfB474eF87bedCb`. These are already in `@nestledger/shared` `addresses[91562037]`, and `DEPLOY_BLOCK[91562037]` is set, so your "not deployed yet" notices should disappear for these three.
  - `addresses[31337]` holds a local hardhat deploy. Run `pnpm --filter @nestledger/contracts exec hardhat node`, then `hardhat run scripts/deploy.ts --network localhost` to reproduce those same addresses.
  - The ABIs in shared are now the **implementation** ABIs, a superset of the interfaces: they add `pause`, the role functions, `registry()`, `ledger()` and so on.
  - 27 contract tests pass, covering every A1 item in SPEC §5.11 (registry/passport, rental happy path, timeouts, claims, safety).
  - **v1 limits (fixed in v2 after A2/A3):** RentalEscrow's resolver and ledger are the zero address, so on v1 you **must offer leases with `flatId: 0`** (no society flat), and **`respond` with a non-zero dispute mask reverts** (there is no DisputeResolver yet). Accept-all (`respond(id, 0)`), silence, the baseline flow, rent, move-out, `releaseDepositInFull` and `finalizeNoClaim` all work.
  - **Demo cast registered + verified on-chain** (real txs): MEERA, ROHAN, ASHA, PRIYA, C3–C5, IMRAN, ARB1–3. AGENT, KEEPER and ADMIN are not registered (they don't need to be). Use a fresh wallet to test `/onboard`.
  - `ATTESTOR_ROLE` is granted to AGENT `0xe0f03d31682Fe94548730668b56A4068E69b064b`. Tier params are the demo value (2 on-time payments = Tier 2).
  - Next for me: `lap1/d1-indexer` (indexer + IndexedEvent emitter, `/timeline`, `/public/*`, `/me/*`, `/gas/drip`). After that your B2 agent can attest real claims.
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
