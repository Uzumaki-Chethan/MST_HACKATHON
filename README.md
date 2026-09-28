# NestLedger

**The trust layer for home living.** Rent deposits, society maintenance funds and home renovation budgets sit in smart contracts on MST Blockchain, not in the landlord's, committee's or contractor's account. An AI attestor agent checks the photos and invoices, and humans decide every contested rupee.

![MST Testnet](https://img.shields.io/badge/MST%20Testnet-chain%2091562037-0F766E) ![BridgeKey](https://img.shields.io/badge/wallet-BridgeKey-0F766E) ![Contracts verified](https://img.shields.io/badge/MSTScan-6%20contracts%20verified-0F766E) ![Tests](https://img.shields.io/badge/tests-61%20contract%20%2B%2046%20backend-0F766E)

Built at the MST Blockchain × Newrro Buildathon (28–29 Sep 2026). The full spec is in [docs/SPEC.md](docs/SPEC.md), and every deviation from it is listed in [docs/SPEC-CHANGES.md](docs/SPEC-CHANGES.md).

---

## Contents

1. [Problem and solution](#problem-and-solution)
2. [Live links](#live-links)
3. [How it works](#how-it-works)
4. [MST integration](#mst-integration)
5. [The AI attestor](#the-ai-attestor)
6. [Security and privacy](#security-and-privacy)
7. [Judge guide](#judge-guide)
8. [Setup](#setup)
9. [Limitations and roadmap](#limitations-and-roadmap)
10. [Acknowledgements](#acknowledgements)

---

## Problem and solution

In Bengaluru, almost every large payment around a home is made on blind trust, and the party holding the money has no reason to be fair.

- **Deposits.** Tenants hand over 6–10 months' rent as a deposit, held entirely by the landlord. At move-out, deductions are arbitrary and refunds take months.
- **Society funds.** Apartment associations collect lakhs every month in maintenance, with no visibility into how it's spent. Inflated vendor bills go unchallenged.
- **Renovations.** Homeowners pay contractors large advances. When work stalls or the contractor vanishes, they have no leverage once the money is gone.

The pattern is the same each time: one interested party holds the money, there's no neutral record of what was agreed or delivered, and the only recourse is a legal fight that costs more than the amount at stake.

**NestLedger's rule is that no home-related money moves until the agreed condition is met and verified.** The money sits in contracts on MST Testnet. An AI agent with its own wallet reads the evidence and writes a hashed verdict on-chain, but that verdict never moves money on its own. It only decides whether *silence counts as consent*. The payer, a society committee or a panel of three arbiters makes every contested decision, and the contract pays out the result. Every participant builds a non-transferable **NestPassport**, so good tenants pay smaller deposits.

### One primitive, three products

> payee claims itemised amounts → AI attests how much of each item the evidence supports → payer accepts or disputes per item → silence pays the AI-backed items and escalates the rest → arbiters rule per item → the contract pays out

| Product | Payer (can object) | Payee (claims) | What gets claimed |
|---|---|---|---|
| **DepositLock** (rent) | Tenant | Landlord | Unpaid rent + damage deductions from the deposit |
| **BuildSafe** (renovation) | Homeowner or society treasury | Contractor | A milestone's line items, each with a materials advance |
| **SocietyLedger** (society funds) | Society treasury, via committee and resident votes | Vendor | An invoice, AI-extracted and anomaly-checked, with approvals that scale with risk |

---

## Live links

The demo runs from a team laptop behind Cloudflare quick tunnels ([docs/HOSTING.md](docs/HOSTING.md)). **Tunnel URLs change when the tunnels restart**, and this section is updated when they do.

| What | Link | Wallet needed? |
|---|---|---|
| App | https://somebody-manufacture-back-olympus.trycloudflare.com | For actions only |
| Public society dashboard | https://somebody-manufacture-back-olympus.trycloudflare.com/public/society/1 | No |
| A tenant's passport (ASHA) | https://somebody-manufacture-back-olympus.trycloudflare.com/passport/0x6d7B1fB983c8fa39F98e9e12cBe5c1a5694eD685 | No |
| System status (chain, backend, contracts, demo cast) | https://somebody-manufacture-back-olympus.trycloudflare.com/status | No |
| Backend health | https://phrases-considerable-marijuana-chess.trycloudflare.com/health | No |
| Demo video | *added at submission* | |

---

## How it works

### Architecture

```mermaid
flowchart LR
  P["People: tenant, landlord, homeowner, contractor, committee, residents, arbiters"] -->|use app| FE["Frontend (Next.js)"]
  P -->|sign every money action| W["BridgeKey wallet"]
  Pub["Public / judges (no wallet)"] -->|read-only pages| FE
  FE -->|request signature| W
  W -->|signed transactions| C[("MST Testnet 91562037: NestRegistry, NestPassport, RentalEscrow, MilestoneEscrow, DisputeResolver, SocietyLedger")]
  FE -->|reads| C
  FE <-->|REST| BE["Backend (Fastify + SQLite): API, evidence store, SIWE, indexer, keeper, AI attestor agent"]
  C -->|events| BE
  BE -->|attest / finalise txs| C
  BE --> LLM["Vision LLM (Claude or Gemini; fixtures in the demo)"]
```

Humans sign every money action with BridgeKey. The backend has two server wallets:

- **AGENT** attests evidence.
- **KEEPER** triggers timeouts once a deadline passes.

Neither can move funds anywhere a contract rule doesn't already send them.

### The core primitive (`AttestedEscrow`)

`RentalEscrow` and `MilestoneEscrow` both inherit the abstract `AttestedEscrow`. Each agreement holds one or more *tranches*:

```mermaid
stateDiagram-v2
  [*] --> Pending
  Pending --> Open: open (advance paid)
  Open --> Claimed: submitClaim
  Claimed --> Open: requestRework (round + 1)
  Claimed --> Settled: respond(0) or silence with all items backed
  Claimed --> Disputed: respond(mask) or silence with unbacked items
  Disputed --> Settled: onDisputeResolved
  Open --> Refunded: finalizeNoClaim (deadline passed)
```

- **Settled:** the payee gets max(awarded, advance) and the payer gets the rest.
- **Disputed:** undisputed items are paid at once, and only the disputed items stay frozen.

### Design rules every module follows

1. Money never sits with an interested party. It sits in a contract.
2. The AI never moves money alone. It only decides whether silence counts as consent, and whether a society bill needs more approvals.
3. Every waiting state has a deadline, and every deadline has a default that favours whoever acted on time.
4. Undisputed money moves immediately. Disputes are itemised, and arbiters rule per line item.
5. Whoever documents first sets the baseline, and the other side gets a fixed window to contest it.
6. There is no admin path to user funds. Admins can pause *new* agreements, never exits.
7. Private evidence stays off-chain. Only hashes go on-chain. Society invoices are public on purpose.
8. Everything a judge sees is real, and every step in the UI links to its MSTScan transaction.

### Repository layout

| Path | What |
|---|---|
| `packages/contracts` | Hardhat project: 6 contracts + the `AttestedEscrow` core, 61 tests, deploy / verify / actor scripts |
| `packages/shared` | `@nestledger/shared`: chain config, ABIs + addresses, money helpers, hashing, enums, time windows, zod schemas |
| `packages/backend` | Fastify API, SQLite, evidence store, SIWE, indexer, keeper, AI tasks + agent, seed script (46 tests) |
| `packages/frontend` | Next.js app (App Router), wagmi + viem, BridgeKey connect, every page in SPEC §8.3 |
| `docs/` | Spec, spec changes, work split, hosting, demo cast, demo script |

---

## MST integration

### Chain configuration

| Field | Value |
|---|---|
| Network | MST Testnet |
| Chain ID | `91562037` (`0x5752035`) |
| RPC | `https://testnetrpc.mstblockchain.com` |
| Currency | tMSTC (18 decimals). Every on-chain amount is wei of native tMSTC; there are no ERC-20s |
| Explorer | https://testnet.mstscan.com |
| Faucet | https://faucet.masterstroke.academy |

The same config is in [`packages/shared/src/chain.ts`](packages/shared/src/chain.ts): viem `defineChain`, explorer link helpers, and the `wallet_addEthereumChain` parameters.

### Contracts (testnet v2, all verified on MSTScan)

Deployed from block `5789828` by `0x6410E1fE8066A5d28af8c4A23edB4Bb788519214` (ADMIN).

| Contract | Role | Address |
|---|---|---|
| **RentalEscrow** | DepositLock: leases, rent split, baseline, move-out, deposit claims | [`0xEF1ed68f299B47d78719b4a7a635E7e610753629`](https://testnet.mstscan.com/address/0xEF1ed68f299B47d78719b4a7a635E7e610753629) |
| **MilestoneEscrow** | BuildSafe: milestones, advances, rework rounds, change orders, stall rule | [`0x20feF97Dae8b896f7ca08740Fb176D1b32a1846a`](https://testnet.mstscan.com/address/0x20feF97Dae8b896f7ca08740Fb176D1b32a1846a) |
| **SocietyLedger** | Society treasury: maintenance, tiered proposals, resident votes, AI invoice checks | [`0xb19d9d63A50b14C35c3DFFF9e5b8C8E7C6923377`](https://testnet.mstscan.com/address/0xb19d9d63A50b14C35c3DFFF9e5b8C8E7C6923377) |
| **DisputeResolver** | 3-arbiter panels, per-item votes, dispute bond | [`0x7868AcEb5f4d043476793086198870d90Bfe78d4`](https://testnet.mstscan.com/address/0x7868AcEb5f4d043476793086198870d90Bfe78d4) |
| **NestPassport** | Soulbound reputation: 22 stats, tenant tiers, trust-priced deposits | [`0x7d8706C27ed1385E37a516Bd1094Fc0e4a3B8002`](https://testnet.mstscan.com/address/0x7d8706C27ed1385E37a516Bd1094Fc0e4a3B8002) |
| **NestRegistry** | Users, roles, verification, module and attestor roles | [`0x53cdf6bfF53357f60c5eC9Dd4552f243837ec9f8`](https://testnet.mstscan.com/address/0x53cdf6bfF53357f60c5eC9Dd4552f243837ec9f8) |

The same addresses are exported from [`packages/shared/src/addresses.ts`](packages/shared/src/addresses.ts), and the ABIs from [`packages/shared/src/abis/`](packages/shared/src/abis/).

- **Wiring:** MODULE_ROLE goes to the four modules, ATTESTOR_ROLE to AGENT, and arbiters ARB1–3 are added.
- **Demo parameters:** tenant tiers need 2 on-time payments, the dispute bond is 0.001 tMSTC, and the arbiter voting window is 300 s.

The spec also planned **TankerTrust** (IoT water deliveries). The team dropped it during the event, and its interface stays in `contracts/interfaces/` because Appendix A was frozen (see SPEC-CHANGES).

### Transactions by type

All real, all on MST Testnet v2, from the seed run (`packages/backend/scripts/seed.ts`) and the backend's own server wallets. The *Signed by* column shows who sent each one:

- **Scripted:** demo-cast keys used by the seed script.
- **AGENT / KEEPER:** the backend's two server wallets.

| # | Type (function) | Contract | Signed by | Transaction |
|---|---|---|---|---|
| 1 | `register` (mints the soulbound passport) | NestRegistry | MEERA (scripted) | [`0xa4d8…f954`](https://testnet.mstscan.com/tx/0xa4d8475aba928d26ea44ea97c89a08f33d1f61cdacf40326596e0427ffc5f954) |
| 2 | `verify` | NestRegistry | ADMIN | [`0x7210…ca0`](https://testnet.mstscan.com/tx/0x72107db2829ec866e63e30255afbfcd1ed65d52dee376891e149d09fa2d1fca0) |
| 3 | `addArbiter` | DisputeResolver | ADMIN | [`0x17a1…f120`](https://testnet.mstscan.com/tx/0x17a13f8e3a09ee9f91d9d8dcb71d875315b95e06478e2980119566c3270df120) |
| 4 | `setTierParams` | NestPassport | ADMIN | [`0xe508…e173`](https://testnet.mstscan.com/tx/0xe5084b4942aa8c150d499ef3cd046a53abc49ebae8595d7a7cf3c6a27c38e173) |
| 5 | `createSociety` (Green Meadows Residency) | SocietyLedger | MEERA (scripted) | [`0x9354…18c7`](https://testnet.mstscan.com/tx/0x93545e5227e14e1d68bf623de1b36f574a87704431e872b23ed61377a76d18c7) |
| 6 | `addFlat` (A-101) | SocietyLedger | MEERA (scripted) | [`0x2581…3483`](https://testnet.mstscan.com/tx/0x2581cbe32c4db1b3b39f37226ad3273478058fa6a161ef176726c095e7343483) |
| 7 | `payMaintenance` | SocietyLedger | PRIYA (scripted) | [`0xc15d…e1af`](https://testnet.mstscan.com/tx/0xc15d0a915b907b72e627e26ade9261b6c04f9ba8a9ed812cecfcbc5e2898e1af) |
| 8 | `propose` (PayVendor, ₹1,200 plumbing invoice) | SocietyLedger | MEERA (scripted) | [`0x7e42…2972`](https://testnet.mstscan.com/tx/0x7e42c77c8d78d4e142c4119e2fbe4f6d09256b572b3287e8ccf57fa5b342e972) |
| 9 | `attestInvoice` (risk 0, clean) | SocietyLedger | **AGENT** | [`0x81c3…a5bc`](https://testnet.mstscan.com/tx/0x81c3b043d7d05ef38d04d08650753730a5ac62a82aeaadb3dd02037ae932a5bc) |
| 10 | `execute` (pays the vendor) | SocietyLedger | **KEEPER** | [`0x2ebb…4709`](https://testnet.mstscan.com/tx/0x2ebb4df7bed31fc388f80ebaa317b3e4465c624ed2fd80997e859edf97164709) |
| 11 | `offerLease` | RentalEscrow | ROHAN (scripted) | [`0x272e…1a5b`](https://testnet.mstscan.com/tx/0x272ee5ddf08818779f9813167eb821cd0072f9d25ea0e87899a0fe40c0911a5b) |
| 12 | `signLease` (**deposit locked**, ₹1,80,000) | RentalEscrow | ASHA (scripted) | [`0x5dd8…1621`](https://testnet.mstscan.com/tx/0x5dd8432d05d16b561f66c5b77f25cac3c29416bc10e5caec8362c7cc34181621) |
| 13 | `payRent` (rent → landlord, maintenance → society) | RentalEscrow | ASHA (scripted) | [`0x9f99…1429`](https://testnet.mstscan.com/tx/0x9f9904cdc3a874cdfe700e08da69608940b6725cf24cfdc2267bb89f3d661429) |
| 14 | `submitBaseline` (move-in evidence hash) | RentalEscrow | ASHA (scripted) | [`0x5ece…ee5e`](https://testnet.mstscan.com/tx/0x5ecbe4eb16369ee9a008b0bcd815dea3e2b77de70696d8dcb80a7c17dd82ee5e) |
| 15 | `finalizeBaseline` (landlord silent → presumed accepted) | RentalEscrow | **KEEPER** | [`0x7c6a…e3951`](https://testnet.mstscan.com/tx/0x7c6a8c3af1e914d66ab123d35355c2e80d5b69ffe2ccede7a3c15bfc41be3951) |
| 16 | `createProject` (3 milestones, funded in full) | MilestoneEscrow | ROHAN (scripted) | [`0xa0e2…300d`](https://testnet.mstscan.com/tx/0xa0e2d0c5ba238b6a670247554cfc2f93f0c4c7e680571b3581a91d0718f4300d) |
| 17 | `acceptProject` (pays milestone 0's advance) | MilestoneEscrow | IMRAN (scripted) | [`0x4ae3…b75a`](https://testnet.mstscan.com/tx/0x4ae388772e1db53fe903a638cd1320e146940e9e3b420f9688787c8b5f38b75a) |
| 18 | `submitClaim` (milestone 0 line items) | MilestoneEscrow | IMRAN (scripted) | [`0xaa09…072f`](https://testnet.mstscan.com/tx/0xaa09e0a160f1dad89f3bdd3d7d84012c6a2ce852fda2b70ec3872791c2a4072f) |
| 19 | `attest` (per-item AI backing) | MilestoneEscrow | **AGENT** | [`0xd740…e480`](https://testnet.mstscan.com/tx/0xd740c2bb075a77d010d1b18bcb20aea1c9579a69070fe3fa3e0d143cdfaee480) |
| 20 | `respond(0)` (approve; opens milestone 1 and pays its advance) | MilestoneEscrow | ROHAN (scripted) | [`0xf8e9…b1c`](https://testnet.mstscan.com/tx/0xf8e9a06729ba2776c3cab358a83aa0379b9730db581019d8ac94a13144a10b1c) |

The live demo adds `startMoveOut`, rental `submitClaim` + `attest`, `respond(mask)`, arbiter `vote`, a trust-priced `offerLease`, `finalizeAfterSilence`, and a flagged `attestInvoice` with override `approve`s. The seed alone produced 72 transactions; the full list is on each contract's MSTScan page.

### BridgeKey

BridgeKey is the only wallet the app asks for ([`ConnectBridgeKey`](packages/frontend/src/components/ConnectBridgeKey.tsx)):

- **Connect:** picks the EIP-6963 provider whose name contains "BridgeKey", falls back to `window.ethereum`, and shows install links if neither exists.
- **Network guard:** `wallet_switchEthereumChain` to `0x5752035`. On error 4902 it calls `wallet_addEthereumChain` with the shared parameters.
- **Sign-in:** SIWE (`personal_sign`) with chain ID 91562037, which gets a JWT for the backend's private evidence.
- **Every money action is a BridgeKey signature:** register, sign lease, pay rent, submit baseline, move-out, claim, respond or dispute, vote, propose, approve with override reason, create project, accept, and more. Each goes through one `useTx` hook, which shows a toast with the MSTScan link.

### Vibe Kit

The repo was scaffolded with the official MST Vibe Kit (`create-mst-app --template blank`). We kept its turbo pipeline, workspace scripts, Hardhat network config (`testnet` = 91562037), the deploy and verify script pattern, and its same-origin RPC proxy (`/api/rpc/testnet`), which the frontend needs because the MST RPC sends no CORS headers.

### MST SDK

The spec planned to use `@mstblockchain/mst-sdk` for the backend's gas drip and health checks. **We didn't end up using it.** The backend uses ethers v6 (`JsonRpcProvider` + `Wallet`) against the MST RPC for the gas drip, `getBlockNumber` and `getBalance`, and the frontend uses viem/wagmi. The SDK is still listed in the frontend's dependencies from the Vibe Kit template but isn't imported.

---

## The AI attestor

**What it does.** The backend runs one agent with its own wallet (AGENT, `ATTESTOR_ROLE`). It watches the indexer for new claims and proposals, runs a vision task, stores the full JSON report, and posts the report's hash and per-item backing on-chain:

| Task | Input | Output on-chain |
|---|---|---|
| Move-in / move-out comparison | Room photos from the same vantage points, before and after | Per claim item: supported amount, overall score, report hash |
| Milestone check | Contractor's site photos vs the design reference images | Per line item: supported fraction × cap, match score |
| Invoice check | Invoice photo + the society's payment history | Risk score 0–100, flagged or not, report hash |

- **Numbers come from code; words come from the LLM.** The model classifies (new damage vs normal wear, complete vs partial) and picks rate-card items. Code computes every rupee, cap and threshold.
- **Normal wear is always ₹0.**
- **Invoice anomaly rules R1–R7 are deterministic.** They are price vs the category median, vendor month-to-date spend, duplicate invoice numbers, and so on. The LLM only writes the one-line justification.
- **Integrity checks run on every upload:** keccak duplicates, perceptual-hash reuse detection, photo freshness, EXIF time and a 200 m geofence.
- **Fail-safe:** reused or stale photos, low confidence (< 0.6) or invalid output all mean zero support. Nothing is backed, and humans decide.

**What it can't do.** It can't move money.

- **Rent and renovation claims:** a backed item is paid only if the payer stays silent. Anything the payer disputes goes to three human arbiters.
- **Society bills:** a flag only raises the approval tier and resets approvals. Each committee member must then write an override reason, which is published on the public dashboard.

**Fixtures mode (used in the live demo).** `LLM_PROVIDER=fixtures` returns recorded model outputs from `packages/backend/src/ai/fixtures/`. The rest of the pipeline stays real: integrity checks, code rules, report hashing, and the on-chain attestation from the agent wallet. Every report then says `"model": "fixtures"`, and the UI shows an **"AI: fixture mode"** badge. To use a real model, set `LLM_PROVIDER=anthropic` (or `gemini`) and the API key, then restart the backend.

---

## Security and privacy

**Contracts**
- Solidity 0.8.24, OpenZeppelin 5.0 (`AccessControl`, `ReentrancyGuard`, `Pausable`), and custom errors.
- `nonReentrant` on every state-changing function, following checks → effects → interactions.
- **Pull-payment fallback:** a failing recipient never blocks a settlement. Its payout moves to `withdrawable`, and the recipient claims it with `withdraw()`.
- **No admin fund path:** no role can move escrowed money outside the contract rules, and a test asserts it. Pausing only stops *new* leases, projects, societies and proposals, so money can always leave.
- **Bounded loops:** at most 10 claim items and 12 milestones, and committees of 1–5.
- **Reputation can't be edited:** passport stats are written only by registered modules, from real flows. When a seed-ordering bug recorded a wrong late payment, we redeployed rather than edit it (SPEC-CHANGES).

**Evidence and privacy (N9)**
- Only hashes go on-chain. Photos and reports live in the backend's content-addressed store.
- Files are readable only by the parties, their assigned arbiters and the agent (SIWE + JWT). No names go on-chain.
- Society invoices and AI invoice reports are public on purpose. That's the point of the treasury.

**Server wallets**
- AGENT can only attest.
- KEEPER can only call functions that anyone may call once a deadline passes, and it dry-runs every call with `staticCall` first.
- Their keys live only in the backend's `.env.local`, which is never committed.

---

## Judge guide

### No wallet needed

- **`/public/society/1`:** Green Meadows Residency's treasury. It shows the balance, collections vs spending, and every payout with its invoice image, AI risk score, approvers, override reasons and MSTScan link.
- **`/passport/<address>`:** anyone's soulbound reputation, for example ASHA's (link above).
- **`/status`:** chain and block, backend health, indexer lag, AI mode, all contracts, and the demo-cast wallets with live balances.

### With BridgeKey

1. Install BridgeKey and open the app. **Connect BridgeKey** adds and switches to MST Testnet for you.
2. Get tMSTC from the faucet: https://faucet.masterstroke.academy
3. Go to **`/onboard`**, pick a role and register. This mints your passport. After registering, the app sends a small gas top-up once.
4. Try it:
   - `/rent/new`: offer a lease to a second wallet of yours (trust pricing shows the tier-based deposit).
   - `/build/new`: create a milestone project.
   - `/society/new`: create your own society.

   Each step links to its transaction on MSTScan.
5. **Want to see a finished flow?** The seeded lease `/rent/1` (ROHAN → ASHA), project `/build/1` (ROHAN → IMRAN) and society `/society/1` are readable by anyone. Only their parties can act on them.

Demo timings are seconds, not days, so things move while you watch. For example, a rent period is 90 s and a claim window is 120 s.

---

## Setup

**Prerequisites:** Node 20–22, pnpm 9. On Windows with Node 24, `better-sqlite3` needs Node 22 for install.

```bash
pnpm install
cp .env.example .env.local        # fill in keys; one repo-root file serves every package
pnpm --filter @nestledger/contracts compile   # also exports ABIs to packages/shared
```

**Environment** (see `.env.example`):

| Part | Variables |
|---|---|
| Contracts | `PRIVATE_KEY` (ADMIN), `MSTSCAN_API_KEY`, `ATTESTOR_ADDRESS`, `ARBITER_1..3`, `DEMO=1` |
| Backend | `ATTESTOR_PRIVATE_KEY`, `KEEPER_PRIVATE_KEY`, `JWT_SECRET`, `PUBLIC_WEB_ORIGIN`, `LLM_PROVIDER` (`fixtures` / `anthropic` / `gemini`), API key |
| Frontend | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_INR_PER_MSTC` |

**Run, test, deploy**

```bash
pnpm --filter @nestledger/contracts test          # 61 tests
pnpm --filter @nestledger/backend test            # 46 tests
pnpm --filter @nestledger/backend dev             # API + indexer + keeper + AI agent on :8080
pnpm --filter @nestledger/frontend dev            # app on :3000

pnpm --filter @nestledger/contracts deploy:testnet   # writes shared/src/addresses.ts + ABIs
pnpm --filter @nestledger/contracts verify:testnet   # MSTScan verification
pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/register-cast.ts --network testnet
pnpm --filter @nestledger/backend exec tsx scripts/seed.ts   # with the backend running
```

**Public hosting:** `powershell -ExecutionPolicy Bypass -File .\start-public.ps1` starts the backend, a production frontend build and two Cloudflare tunnels ([docs/HOSTING.md](docs/HOSTING.md)).

---

## Limitations and roadmap

**What is simulated or scripted in the demo.** Everything else is live on MST Testnet.
- **Time windows are seconds, not days.** The windows are contract parameters, and production defaults are in SPEC §4.6:

  | Window | Demo | Production |
  |---|---|---|
  | Rent period | 90 s | 30 days |
  | Deposit claim window | 120 s | 14 days |
  | Response window | 90 s | 7 days |
  | Arbiter voting | 300 s | 5 days |
  | Resident voting | 120 s | 7 days |

- **Demo INR rate:** amounts are tMSTC on-chain. Rupees are shown at a labelled demo rate of ₹10,00,000 per tMSTC, so ₹30,000 rent = 0.03 tMSTC.
- **Scripted actors:** committee members C3–C5 and arbiters ARB2–ARB3 sign from scripts during the live demo, and the UI labels them. The seeded history was also sent by script from the demo-cast keys. The people are fictional, and every wallet and transaction is real.
- **AI fixtures mode:** the demo uses recorded model outputs (labelled "AI: fixture mode"). The integrity checks, the rules and the on-chain attestations still run.
- **Hosting:** quick tunnels from a laptop, not a managed host, because the AGENT and KEEPER keys and the seeded evidence live on that machine.
- **Not built:** TankerTrust / IoT (dropped), change orders in the UI (the contract supports them), and PDF invoices (photos only).

**Roadmap (not built):** an INR stablecoin with a UPI on-ramp, gasless transactions through a paymaster, DigiLocker-based verification, society-specific arbiter pools with staking and random selection, e-stamped rental agreements, and insurance for deposits in dispute.

---

## Acknowledgements

- **All code in this repository was written during the event** (28–29 Sep 2026), and the commit history shows it.
- **Built on:**
  - [MST Vibe Kit](https://mstblockchain.com) (`create-mst-app`), used for the scaffold.
  - OpenZeppelin Contracts 5.0.
  - Hardhat.
  - Next.js, wagmi, viem and TanStack Query.
  - Fastify, better-sqlite3, ethers v6, sharp, exifr, blockhash-core and canonicalize.
  - zod, Tailwind CSS, recharts and qrcode.react.
- **AI tools:** the team built NestLedger with **Claude Code** (Anthropic), running as two parallel sessions:
  - Laptop 1: contracts and backend.
  - Laptop 2: AI agent and frontend.

  The coordination files are [`CLAUDE1.md`](CLAUDE1.md) and [`CLAUDE2.md`](CLAUDE2.md). At runtime the attestor can use Anthropic Claude or Google Gemini vision models.
- **Demo content:** the people, the society, the vendor and all the invoices are fictional. The images are generated and labelled as demo images.
