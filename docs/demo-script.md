# NestLedger final demo script (about 6½ minutes)

Based on SPEC §11.3, with the TankerTrust beat removed (dropped by team decision, see SPEC-CHANGES). Every transaction shown is real, on MST Testnet. Anything scripted is said out loud and labelled in the UI.

## Cast and screens

| Who | BridgeKey account | Where |
|---|---|---|
| Presenter | none | Projector: the app URL in a logged-out browser window |
| ASHA (tenant) | ASHA | Phone for photos (QR handoff), plus a laptop tab |
| ROHAN (landlord, homeowner) | ROHAN | Laptop tab |
| ARB1 (arbiter) | ARB1 | Laptop tab |
| IMRAN (contractor) | IMRAN | Laptop tab |
| MEERA (society chair) | MEERA | Laptop tab |
| ARB2, C3, C4 | scripted actors | Laptop 1 terminal (say "scripted" every time) |

With one laptop, keep one browser profile per person, or switch accounts in BridgeKey and reload. The app follows the active account.

## Before judging (T–15 min)

1. **Laptop 1:** run `powershell -ExecutionPolicy Bypass -File .\start-public.ps1`, or confirm the 4 windows are still running.
2. **Check the backend:** `<web>/status` must show backend OK, indexer lag < 5, "AI: fixture mode", and AGENT + KEEPER balances > 0.05.
3. **Stage the tabs:**
   - Projector: `<web>/public/society/1`.
   - `/rent/<lease>` in the ASHA and ROHAN profiles.
   - `/build/<project>` in the IMRAN and ROHAN profiles.
   - `/society/1` (Proposals tab) in the MEERA profile.
   - `/arbiter` in the ARB1 profile.
4. **Sign in:** sign in with SIWE once in every profile. The sign-in lasts 12 h.
5. **Open a terminal:** a PowerShell window in the repo root for the scripted actors.
6. **Use a fresh lease and project:** after any rehearsal, use the new ids that the reset gives you (see "Reset between runs" below). Never reuse a lease that has already moved out.

## The run

| Time | Beat | Who does what (click by click) | Transactions |
|---|---|---|---|
| 0:00 | **Problem** | One slide. "Deposits, society funds, renovation advances: in every case, one interested party holds the money, and the only recourse is a court case that costs more than the money." | none |
| 0:30 | **"Every rupee of this society is public"** | Projector on `/public/society/1`, no wallet. Show: balance, collections vs spending chart, 6/6 flats paid, 3 plumbing payouts with invoice image, **AI risk 0**, approver and MSTScan link. | reads only |
| 1:00 | **DepositLock history** | ROHAN tab, `/rent/<lease>`, scroll to **On-chain history**. Point at: deposit locked (`signLease`); baseline **presumed accepted because the landlord ignored it** (`finalizeBaseline` sent by KEEPER); rent ×2 split landlord / society. Click one MSTScan link. | `signLease`, `finalizeBaseline`, `payRent` |
| 1:30 | **Move-out, live** | 1. ASHA tab: **Move out**, then **Start the move-out walkthrough**, then **Use my phone camera instead (QR code)**. 2. Phone: scan the QR code and shoot the 4 vantage photos (living room, kitchen, bedroom, bathroom; ghost overlay; live camera only). Use 4 **different** real scenes: a reused or stale photo gets ₹0 AI backing (by design). 3. Laptop: the photos appear as "Received from your phone". 4. The AI report shows the **cracked tile: new damage, ₹450** and the **faded paint: normal wear, not deductible (₹0)**. 5. Click **Start move-out** and sign in BridgeKey. | `startMoveOut` |
| 2:30 | **Greedy claim** | 1. ROHAN tab (reload): **Claim deductions or release the deposit**. 2. The tile (₹450) is pre-filled from the AI report. 3. Add an item, "Repaint whole wall", ₹6,000. Note the red "not AI-backed" warning. 4. **Submit claim** and sign. 5. **Within seconds the agent's attestation appears:** tile ✓ backed, repaint ✗ not backed. Open the `attest` tx: it was sent by the AGENT wallet. | `submitClaim`, `attest` (AGENT) |
| 3:15 | **Itemised dispute** | 1. ASHA tab: tick **only** the repaint item. 2. **Dispute selected items** and sign (the 0.001 tMSTC bond). 3. Show that ₹450 went to ROHAN and the undisputed remainder to ASHA **in the same tx**. 4. ARB1 tab `/arbiter`: open the dispute, **Reject** the repaint, and sign `vote`. 5. Terminal: run the **scripted** ARB2 vote (command below). Say: "ARB2 is a scripted actor". 6. Two matching votes, so the ₹6,000 returns to ASHA and the tranche is settled. | `respond(mask)`, `vote` ×2, payout |
| 4:15 | **Reputation pays** | 1. ASHA tab: **See your updated NestPassport**: **Tier 3**. 2. PRIYA (or ROHAN) tab: **Offer a new lease with trust pricing** to ASHA. The required deposit **halves**: 6 months → 3. Sign `offerLease`. | `offerLease` |
| 4:45 | **BuildSafe (same engine)** | 1. IMRAN tab, `/build/<project>`, milestone 1: capture the vantage photos (ghosts of the design references), check the AI result (score ≥ 80, ticks per line item), **Submit claim** and sign. 2. The AGENT attests within seconds. 3. ROHAN **does nothing**. While waiting, show the advance paid at acceptance and the stall rule (only the homeowner can cancel a stalled milestone, and it refunds everything but the advance). 4. After the 90 s response window, KEEPER calls `finalizeAfterSilence`, and **the backed items pay out: contractor protection**. | `submitClaim`, `attest`, `finalizeAfterSilence` (KEEPER) |
| 5:30 | **SocietyLedger** | 1. MEERA tab, `/society/1`, Proposals, **New proposal (committee)**: payee PLUMBER, ₹4,800, category plumbing, upload `docs/demo-assets/invoice-4800.jpg` (fictional vendor), then **Propose payment** and sign. 2. Within seconds the AI flag: **"₹4,800 is 3.56× the plumbing median of ₹1,350"**. The tier escalates and **approvals reset to 0**. 3. MEERA: **Approve with override reason**, write a reason, sign. 4. Terminal: **scripted** C3 and C4 approvals, each with an override reason (command below). 5. KEEPER executes. 6. Projector: reload `/public/society/1`. The new payout shows the **flag, the justification and all three override reasons**. | `propose`, `attestInvoice` (AGENT), `approve` ×3, `execute` (KEEPER) |
| 6:15 | **Close** | "One primitive, three everyday problems, 20+ transaction types on MST Testnet. Next: INR stablecoin and UPI on-ramp." Show ASHA's passport QR. | none |

**Windows are short (demo speed):** ROHAN has **120 s** to claim after move-out and ASHA has **90 s** to respond. Have both tabs open and signed in before move-out. If a window lapses, the contract follows its default (full refund, or silence escalates to arbiters); narrate it, since that *is* the product.

**Timing tip:** BuildSafe has a 90 s silence wait. Have IMRAN submit the milestone claim **during the 3:15 dispute beat**, so the keeper release lands by 5:15.

## Scripted actors (Laptop 1 terminal, repo root)

These sign with demo-cast keys from `.env.local`. Say they are scripted; the UI labels them.

```powershell
# ARB2 votes on dispute <D>. UPHOLD_MASK: bit i = uphold disputed item i (0 = reject all)
$env:DISPUTE_ID="<D>"; $env:UPHOLD_MASK="0"; pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/arbiter-vote.ts --network testnet

# C3 and C4 approve proposal <P>, each with an override reason (needed once the AI flagged it)
$env:PROPOSAL_ID="<P>"; pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/committee-approve.ts --network testnet
```

## Fallbacks

| Failure | What to do and say |
|---|---|
| Venue Wi-Fi | Laptop 1 on a phone hotspot. The public URLs don't change as long as the tunnels keep running |
| Phone camera / QR fails | Use the laptop's own camera in the capture wizard |
| RPC slow | Keep talking. Each beat needs only 1–2 fresh txs. Open the tx on MSTScan while it confirms |
| Agent attestation slow | Check `/status` (indexer lag). The agent retries 3×. The claim still works unbacked. Say so |
| BridgeKey issue | Switch to a second browser profile with the same key imported, or run the step as a scripted actor, and say so |
| A window expires at the wrong moment | Windows are parameters. Move on and show the result on the timeline, or rerun the beat on a fresh lease |
| LLM question | "The demo runs in fixture mode, which the badge shows. The integrity checks, the rules and the on-chain attestations are real. With an API key it's live Claude or Gemini" |

## Reset between runs

A rehearsal uses up the lease (it moves out and settles), the milestone and the society bill. The contracts never allow rewinding state, and passport stats can't be edited. So before the judged run, either:

- run the reset script, which creates a fresh lease, project and tenant history on the same contracts (new ids), and put its ids into the tabs above, **or**
- redeploy and reseed (`deploy.ts`, `verify.ts`, `register-cast.ts`, `seed.ts`), then update the README addresses and rebuild the frontend.

Then rerun the "Before judging" checklist.
