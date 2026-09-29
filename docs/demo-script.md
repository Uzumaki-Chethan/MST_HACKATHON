# NestLedger demo script (about 6 minutes)

Rental (DepositLock) and society funds (SocietyLedger), on MST Testnet with a live AI model (Gemini). Renovations (BuildSafe) and TankerTrust are not in the demo. Every transaction is real; anything scripted is said out loud and labelled in the UI.

App: `https://stack-bikes-invitation-arms.trycloudflare.com` (the current URL is always in `PUBLIC-URLS.local.txt` on Laptop 1).

## The demo leases (use each one once)

ROHAN is the landlord of every lease. Each lease was signed, both rents were paid on time, and the move-in photos were accepted by silence, so every tenant starts at **Tier 2**.

| Lease | Tenant (BridgeKey account) | Move-out images to upload |
|---|---|---|
| `/rent/2` | PRIYA | `demo-photos\set-2\after-*.jpg` |
| `/rent/3` | IMRAN | `demo-photos\set-3\after-*.jpg` |
| `/rent/4` | C5 | `demo-photos\set-4\after-*.jpg` |

`/rent/1` (ASHA) was already used in the dry run. Its history is a finished example.

**Always upload the image set that belongs to the lease.** Each lease's move-in photos come from that set, so the AI compares like with like. Another set's images would look like a different flat.

The society has ₹23,950 available, which is enough for 4 runs of the ₹4,800 bill.

## Before judging (T-15 min)

1. **Laptop 1:** the four windows are running (2 tunnels, backend, frontend). `<app>/status` shows the backend OK, the AI model, and AGENT and KEEPER balances above 0.05.
2. **BridgeKey:** import the keys from `.env.local` for:
   - the tenant of your chosen lease (PRIYA, IMRAN or C5),
   - **ROHAN**, **ARB1** and **MEERA**.
3. **Open one browser window per person**, switch BridgeKey to that person, then **Connect BridgeKey** and **Sign in** (a free signature). Pages:

   | Window | Page |
   |---|---|
   | Tenant | `/rent/<N>` |
   | ROHAN | `/rent/<N>` |
   | ARB1 | `/arbiter` |
   | MEERA | `/society/1` (Proposals tab) |
   | Projector, no wallet | `/public/society/1` |

4. **Files:** copy the lease's 4 `after-*.jpg` files and `docs\demo-assets\invoice-4800.jpg` to the Desktop.
5. **Terminal:** open a PowerShell window in the repo root, for the scripted actors.

**The windows are short (demo speed):** after move-out, ROHAN has **120 s** to claim. After the claim, the tenant has **90 s** to respond. Keep ROHAN's and the tenant's windows side by side. If a window lapses, the contract applies its default, and you can narrate that; it's part of the product.

## The run

| Time | Beat | What to do and say |
|---|---|---|
| 0:00 | **Problem** | "Deposits, society funds, renovation advances: one interested party holds the money, and the only recourse is a court case that costs more than the money." |
| 0:30 | **Every rupee is public** | Projector on `/public/society/1`, no wallet. Show: balance, collections vs spending, flats paid, three plumbing payouts, each with its invoice image, **AI check: risk 0** and an MSTScan link. |
| 1:00 | **The lease so far** | Tenant window, `/rent/<N>`, **On-chain history**. Point at: *deposit locked in the contract*, *rent paid ×2 (rent to landlord, maintenance to society)*, *move-in report accepted by silence* (sent by the KEEPER wallet because the landlord ignored it). Click one MSTScan link. |
| 1:30 | **Move-out, the AI checks** | Tenant: **Move out**, then **Start the move-out walkthrough**. For each room, use **Or upload a file**: living, kitchen, bedroom, bathroom from the lease's set. Each photo shows **"Uploaded — not live camera"**. Click **Save photo set** and wait about 20 s for Gemini. The report shows **kitchen: new damage, a cracked tile** (with a ₹ amount from the rate card), and the other rooms unchanged. Say: *"The images are AI-generated for the demo and labelled. The AI check is live."* Click **Start move-out on-chain** and sign. |
| 2:30 | **Greedy claim** | ROHAN (reload): **Claim deductions or release the deposit**. The tile is pre-filled from the AI report. Click **Add another item**: "Repaint living room wall", ₹6,000. It shows a red **not AI-backed** warning. **Submit claim**, sign. **Within seconds the AI agent's attestation appears: tile ✓ backed, repaint ✗ not backed.** Open that transaction: it was sent by the AGENT wallet. |
| 3:15 | **Itemised dispute** | Tenant (reload): tick **only the repaint**. **Dispute selected** and sign (bond 0.001 tMSTC). Show that **the tile money went to ROHAN and the rest of the deposit came back to the tenant in that same transaction**. Only the ₹6,000 is frozen. |
| 3:45 | **Arbiters** | ARB1 window, `/arbiter`: open the dispute. It shows the before/after photos and the AI's reasoning. **Reject** the repaint, write a reason ("faded paint isn't damage; the AI saw no change"), and sign **Vote**. Terminal: run the **scripted** ARB2 vote (below) and say *"ARB2 is a scripted actor."* Two matching votes, so the ₹6,000 goes back to the tenant automatically. |
| 4:30 | **Reputation pays** | Tenant: **See your updated NestPassport**: **Tier 3** and a higher trust score. ROHAN, `/rent/new`: paste the tenant's address, keep **Trust pricing** on. The required deposit **halves** (6 months → 3). Optionally sign **Offer lease**. |
| 5:00 | **Society bill** | MEERA, `/society/1`, Proposals, **Pay a vendor**: vendor `0x509ebe80b4E77d77F919C357Ef291d6b789FD360` (PLUMBER), ₹4,800, category plumbing, upload `invoice-4800.jpg`, then **Upload and run the AI check**. The **AI flag** reads the invoice and says the total is **several times the plumbing median**. **Propose paying**, sign. The tier goes up and **approvals reset**. MEERA writes an override reason, then **Approve with override reason**, sign. Terminal: **scripted** C3 and C4 approve (below). The keeper pays within about 15 s. |
| 5:45 | **Public again** | Projector: reload `/public/society/1`. The new payout shows the **AI flag, its justification and all three written override reasons**. |
| 6:00 | **Close** | "One primitive: claim, AI attests, accept or dispute per item, silence rules, arbiters. Money never sits with an interested party, and the AI never moves money alone. Next: INR stablecoin and UPI on-ramp." Show the tenant's passport QR. |

## Optional beat: residents vote on a big bill (about 3 min)

Bills above ₹50,000 need the residents, not just the committee. The treasury has ₹68,950 available.

1. MEERA, `/society/1`, Proposals, **Pay a vendor**: any vendor address, ₹55,000, category civil (or other), upload an invoice image, run the AI check, then **Propose paying** and sign.
2. Committee approves: MEERA approves in the app (with a reason if flagged), then run the **scripted** C3/C4 `committee-approve` command. The proposal now shows **resident vote open** with a 120 s countdown and a tally bar.
3. Residents vote. MEERA (C-202), ROHAN (B-304) and PRIYA (A-101) click **For** / **Against** in the app. Flats D-101 to D-103 vote with the **scripted** command below.
4. After 120 s the keeper settles it. **Majority for, and quorum met: paid. Otherwise: Rejected**, and the money goes back to the available balance. It then appears on the public page.

An example already exists: proposal 5, a ₹55,000 terrace-waterproofing bill the residents voted down 3–2.

## Scripted actors (Laptop 1 terminal, repo root)

Both scripts find the right dispute or proposal on their own; the ids are optional.

```powershell
# ARB2 rejects every disputed item of the newest dispute that's waiting for it
pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/arbiter-vote.ts --network testnet

# C3 and C4 approve the newest pending proposal, each with a written override reason (waits for the AI first)
pnpm --filter @nestledger/contracts exec hardhat run scripts/actors/committee-approve.ts --network testnet
```

## If something goes wrong

| Problem | What to do and say |
|---|---|
| A page shows a Cloudflare error (530 / 1033) | The tunnel reconnects by itself within about 10 s. Wait and reload. If it keeps failing, move Laptop 1 to the phone hotspot |
| The AI check takes long or fails ("high demand") | Wait about 30 s; it retries. If there's still no attestation, the claim still works but unbacked: *"When the AI can't vouch, humans decide; that's the design."* |
| A window lapses | The contract applies its default: no claim means a full refund, silence means backed items are paid and the rest goes to arbiters. Narrate it, then use the next lease |
| BridgeKey won't sign | Use the second browser profile with the same key, or run that step as a scripted actor and say so |
| A judge asks "are these photos real?" | *"They're AI-generated demo images, labelled on each image, uploaded in demo mode. In production only live camera shots, with timestamp, location and reuse checks, can earn AI backing."* |

## After judging

To show the demo again from scratch, `reset-demo.ps1` deploys fresh contracts, starts a fresh database and seeds 4 new leases (about 25 min). Contracts can't be rewound, by design.
