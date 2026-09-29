// SPEC §11.2 seed + pre-stage, real MST Testnet transactions only. Needs the backend running
// (it uploads evidence and manifests, and relies on the AI agent + keeper to act on-chain).
//   pnpm --filter @nestledger/backend exec tsx scripts/seed.ts [--only=society|history|lease|kitchen]
// The demo cast is fictional; its wallets are real testnet wallets from the repo-root .env.local.
// Never writes reputation directly: every passport stat comes from these real flows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { SiweMessage } from "siwe";
import {
  addresses, formatAmount, hashJson, inrToWei, milestoneEscrowAbi, rentalEscrowAbi, societyLedgerAbi, WINDOWS, ZERO_HASH,
} from "@nestledger/shared";
import { config } from "../src/config.js";

const API = process.env.SEED_API_URL ?? `http://localhost:${config.port}`;
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];
const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
const deployed = addresses[config.chainId];
const W = WINDOWS.demo;
const BENGALURU = { lat: 12.9416, lng: 77.5656 }; // BMS College of Engineering (demo site location)

const wallet = (name: string) => {
  const key = process.env[`${name}_PRIVATE_KEY`];
  if (!key) throw new Error(`${name}_PRIVATE_KEY missing from .env.local`);
  return new Wallet(key, provider);
};
const cast = {
  MEERA: wallet("MEERA"), ROHAN: wallet("ROHAN"), ASHA: wallet("ASHA"), PRIYA: wallet("PRIYA"),
  C3: wallet("C3"), C4: wallet("C4"), C5: wallet("C5"), IMRAN: wallet("IMRAN"), PLUMBER: wallet("PLUMBER"),
};
const ledgerAt = (w: Wallet) => new Contract(deployed.SocietyLedger!, societyLedgerAbi, w);
const rentalAt = (w: Wallet) => new Contract(deployed.RentalEscrow!, rentalEscrowAbi, w);
const milestoneAt = (w: Wallet) => new Contract(deployed.MilestoneEscrow!, milestoneEscrowAbi, w);
const readLedger = new Contract(deployed.SocietyLedger!, societyLedgerAbi, provider);
const readRental = new Contract(deployed.RentalEscrow!, rentalEscrowAbi, provider);
const readMilestone = new Contract(deployed.MilestoneEscrow!, milestoneEscrowAbi, provider);

const log = (m: string) => console.log(m);
const link = (h: string) => `https://testnet.mstscan.com/tx/${h}`;
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tx(label: string, p: Promise<any>) {
  const t = await p;
  await t.wait(1);
  log(`  ✓ ${label.padEnd(46)} ${link(t.hash)}`);
  return t;
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutS = 240) {
  const start = Date.now();
  process.stdout.write(`  … waiting: ${label}`);
  while (!(await check())) {
    if (Date.now() - start > timeoutS * 1000) throw new Error(`timed out waiting for: ${label}`);
    await sleep(3000);
    process.stdout.write(".");
  }
  log(` done (${Math.round((Date.now() - start) / 1000)} s)`);
}

// ------------------------------------------------------------------ backend API

const tokens = new Map<string, string>();
async function login(w: Wallet): Promise<string> {
  const hit = tokens.get(w.address);
  if (hit) return hit;
  const { nonce } = await (await fetch(`${API}/auth/nonce`)).json();
  const origin = new URL(config.publicWebOrigin);
  const message = new SiweMessage({
    domain: origin.host, address: w.address, statement: "Sign in to NestLedger (seed script)",
    uri: origin.origin, version: "1", chainId: config.chainId, nonce,
  }).prepareMessage();
  const res = await fetch(`${API}/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature: await w.signMessage(message) }),
  });
  if (!res.ok) throw new Error(`login failed: ${await res.text()}`);
  const { token } = await res.json();
  tokens.set(w.address, token);
  return token;
}

async function api(w: Wallet, path: string, body: unknown) {
  // AI routes call a real model when LLM_PROVIDER is set; retry its transient "high demand" errors.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await login(w)}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (res.status < 500 || attempt === 5) throw new Error(`${path} failed (${res.status}): ${text}`);
    log(`  … ${path} returned ${res.status}, retrying in ${attempt * 10} s`);
    await sleep(attempt * 10_000);
  }
}

async function manifest(w: Wallet, obj: Record<string, unknown>): Promise<`0x${string}`> {
  const { hash } = await api(w, "/manifests", obj);
  if (hash !== hashJson(obj)) throw new Error("manifest hash mismatch");
  return hash;
}

type Uploaded = { hash: `0x${string}`; mime: string; phash: string | null; checks: Record<string, unknown> | null };
async function upload(w: Wallet, file: Buffer, meta: Record<string, unknown>): Promise<Uploaded> {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("file", new Blob([file], { type: "image/jpeg" }), "photo.jpg");
  const res = await fetch(`${API}/evidence`, { method: "POST", headers: { authorization: `Bearer ${await login(w)}` }, body: form });
  if (!res.ok) throw new Error(`/evidence failed (${res.status}): ${await res.text()}`);
  return res.json();
}

/** Bundle item from an upload response, keeping only the Appendix B.1 check fields. */
function bundleItem(u: Uploaded, extra: Record<string, unknown>) {
  const c = u.checks ?? {};
  const checks = Object.fromEntries(["fresh", "reusedOf", "nearDuplicateOf", "geoOk", "stale"]
    .filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
  return { hash: u.hash, mime: u.mime, ...(u.phash ? { phash: u.phash } : {}), ...(Object.keys(checks).length ? { checks } : {}), ...extra };
}

// ------------------------------------------------------------ generated images

/** A distinct demo "photo" per vantage (seeded pattern, clearly labelled as a demo image). */
async function demoPhoto(label: string, seed: number): Promise<Buffer> {
  const rnd = (n: number) => { seed = (seed * 9301 + 49297) % 233280; return Math.floor((seed / 233280) * n); };
  const shapes = Array.from({ length: 14 }, () =>
    `<rect x="${rnd(1100)}" y="${rnd(620)}" width="${60 + rnd(260)}" height="${40 + rnd(200)}" fill="hsl(${rnd(360)},${30 + rnd(50)}%,${35 + rnd(40)}%)" opacity="0.8"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
    <rect width="1280" height="720" fill="hsl(${rnd(360)},25%,${70 + rnd(20)}%)"/>${shapes}
    <rect x="0" y="640" width="1280" height="80" fill="#0f172a" opacity="0.75"/>
    <text x="32" y="692" font-family="Arial" font-size="36" fill="#fff">${label} · demo image (seed script)</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
}

/** A clearly fictional vendor invoice (SPEC §11.2 step 4). */
async function invoiceImage(no: string, date: string, lines: [string, number][], vendor = "Sharma Plumbing Works (fictional)"): Promise<Buffer> {
  const total = lines.reduce((s, [, v]) => s + v, 0);
  const rows = lines.map(([d, v], i) =>
    `<text x="60" y="${330 + i * 50}" font-size="28">${d}</text><text x="1000" y="${330 + i * 50}" font-size="28" text-anchor="end">₹${v.toLocaleString("en-IN")}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="900" font-family="Arial">
    <rect width="1100" height="900" fill="#fff"/><rect x="0" y="0" width="1100" height="140" fill="#0f766e"/>
    <text x="60" y="85" font-size="44" fill="#fff" font-weight="bold">${vendor}</text>
    <text x="60" y="200" font-size="26">Invoice no: ${no}</text><text x="60" y="240" font-size="26">Date: ${date}</text>
    <text x="1040" y="200" font-size="26" text-anchor="end">Bill to: Green Meadows Residency (fictional)</text>
    <line x1="60" y1="280" x2="1040" y2="280" stroke="#334155"/>${rows}
    <line x1="60" y1="${320 + lines.length * 50}" x2="1040" y2="${320 + lines.length * 50}" stroke="#334155"/>
    <text x="60" y="${370 + lines.length * 50}" font-size="32" font-weight="bold">Total</text>
    <text x="1000" y="${370 + lines.length * 50}" font-size="32" font-weight="bold" text-anchor="end">₹${total.toLocaleString("en-IN")}</text>
    <text x="60" y="860" font-size="20" fill="#64748b">Sample invoice generated for the NestLedger hackathon demo. Not a real vendor.</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

// ======================================================================= steps

const SOCIETY_CFG = {
  threshold: 3, tier1Limit: inrToWei(10_000), tier2Limit: inrToWei(50_000),
  quorumBps: 3000, votingPeriod: W.votingPeriod, attestTimeout: W.attestTimeout,
};
const FLATS: [string, keyof typeof cast][] = [
  ["A-101", "PRIYA"], ["B-304", "ROHAN"], ["C-202", "MEERA"], ["D-101", "C3"], ["D-102", "C4"], ["D-103", "C5"],
];
const MAINTENANCE = inrToWei(2_000);

/** Steps 2–3: Green Meadows Residency, 6 flats, one maintenance payment per owner. */
async function seedSociety(): Promise<{ societyId: bigint; flats: Record<string, bigint> }> {
  log("\n[society] Green Meadows Residency");
  const mine: bigint[] = await readLedger.societiesOf(cast.MEERA.address);
  if (mine.length) {
    const societyId = mine[0];
    const flats: Record<string, bigint> = {};
    for (const fid of await readLedger.flatsOf(societyId)) flats[(await readLedger.getFlat(fid)).label] = fid;
    log(`  = society ${societyId} already exists (flats ${Object.keys(flats).join(", ")})`);
    return { societyId, flats };
  }
  const metaHash = await manifest(cast.MEERA, {
    schema: "nestledger.society.v1", createdAt: now(), displayName: "Green Meadows Residency (fictional)",
    city: "Bengaluru", location: BENGALURU, rulesText: "Demo society for the MST × Newrro buildathon.",
  });
  const societyId: bigint = await readLedger.nextSocietyId();
  const committee = [cast.MEERA, cast.ROHAN, cast.C3, cast.C4, cast.C5].map((w) => w.address);
  await tx(`createSociety → society ${societyId}`, ledgerAt(cast.MEERA).createSociety("Green Meadows Residency", metaHash, committee, SOCIETY_CFG));
  const flats: Record<string, bigint> = {};
  for (const [label, owner] of FLATS) {
    flats[label] = await readLedger.nextFlatId();
    await tx(`addFlat ${label} (${owner})`, ledgerAt(cast.MEERA).addFlat(societyId, label, cast[owner].address, 10, MAINTENANCE));
  }
  for (const [label, owner] of FLATS) {
    await tx(`payMaintenance ${label} (${formatAmount(MAINTENANCE)})`, ledgerAt(cast[owner]).payMaintenance(flats[label], { value: MAINTENANCE }));
  }
  return { societyId, flats };
}

/** Step 4: three real tier-0 plumbing payments (₹1,200 / ₹1,500 / ₹1,350), attested by the agent, executed by the keeper. */
async function seedHistory(societyId: bigint) {
  log("\n[history] plumbing invoices for the anomaly baseline");
  const existing: bigint[] = await readLedger.proposalsOf(societyId);
  if (existing.length >= 3) return log(`  = ${existing.length} proposals already exist, skipping`);
  const bills: [string, string, [string, number][]][] = [
    ["SPW-2026-0412", "2026-06-14", [["Kitchen sink trap replacement", 700], ["Labour", 500]]],
    ["SPW-2026-0457", "2026-07-22", [["Overhead tank valve", 900], ["Labour", 600]]],
    ["SPW-2026-0503", "2026-08-30", [["Common-area tap mixer", 850], ["Labour", 500]]],
  ];
  const ids: bigint[] = [];
  for (const [no, date, lines] of bills) {
    const inr = lines.reduce((s, [, v]) => s + v, 0);
    const up = await upload(cast.MEERA, await invoiceImage(no, date, lines), {
      context: { type: "society", id: societyId.toString(), stage: "invoice" }, kind: "invoice", captureMode: "upload",
    });
    const docHash = await manifest(cast.MEERA, {
      schema: "nestledger.invoice.v1", createdAt: now(), societyId: societyId.toString(), payee: cast.PLUMBER.address.toLowerCase(),
      declaredAmountWei: inrToWei(inr).toString(), declaredAmountINR: inr, category: "plumbing", files: [up.hash],
      note: `Invoice ${no} (fictional vendor)`,
    });
    const id: bigint = await readLedger.nextProposalId();
    await tx(`propose PayVendor ₹${inr.toLocaleString("en-IN")} → proposal ${id}`,
      ledgerAt(cast.MEERA).propose(societyId, 0, cast.PLUMBER.address, inrToWei(inr), docHash, "plumbing", "0x"));
    ids.push(id);
  }
  await waitFor("AI agent attests + keeper executes all 3", async () => {
    const ps = await Promise.all(ids.map((id) => readLedger.getProposal(id)));
    return ps.every((p) => Number(p.status) === 2);
  }, 300);
  for (const id of ids) {
    const p = await readLedger.getProposal(id);
    log(`  proposal ${id}: attested=${p.attested} flagged=${p.flagged} risk=${p.riskScore} status=Executed`);
  }
}

/** A tier-2 bill the residents voted down, so the public ledger shows a declined proposal (not only payouts).
 *  Residents vote only above the tier-2 limit (₹50,000 by the vendor this month), so this is ₹55,000. */
async function seedDeclined(societyId: bigint) {
  log("\n[declined] ₹55,000 terrace waterproofing: committee approves, residents vote it down");
  for (const id of (await readLedger.proposalsOf(societyId)) as bigint[]) {
    if (Number((await readLedger.getProposal(id)).status) === 3) return log(`  = proposal ${id} was already rejected, skipping`);
  }
  const inr = 55_000;
  // The treasury must hold the amount (it is reserved while the vote runs). If it doesn't, the owners pay a
  // one-time ₹10,000 sinking-fund levy each, as societies do before a big repair.
  if (BigInt(await readLedger.availableBalance(societyId)) < inrToWei(inr)) {
    for (const [flatId, owner] of [[1n, "PRIYA"], [2n, "ROHAN"], [3n, "MEERA"], [4n, "C3"], [5n, "C4"], [6n, "C5"]] as const) {
      await tx(`sinking-fund levy ₹10,000 flat ${flatId} (${owner})`, ledgerAt(cast[owner]).payMaintenance(flatId, { value: inrToWei(10_000) }));
    }
  }
  const contractor = process.env.DEVICE_1_ADDRESS!; // a passive demo-cast address, used as the fictional contractor's payout address
  const lines: [string, number][] = [["Terrace waterproofing membrane (1,800 sq ft)", 38_000], ["Labour", 17_000]];
  const up = await upload(cast.MEERA, await invoiceImage("DWC-2026-0088", "2026-09-22", lines, "Deccan Waterproofing Co. (fictional)"), {
    context: { type: "society", id: societyId.toString(), stage: "invoice" }, kind: "invoice", captureMode: "upload",
  });
  const docHash = await manifest(cast.MEERA, {
    schema: "nestledger.invoice.v1", createdAt: now(), societyId: societyId.toString(), payee: contractor.toLowerCase(),
    declaredAmountWei: inrToWei(inr).toString(), declaredAmountINR: inr, category: "civil", files: [up.hash],
    note: "Invoice DWC-2026-0088 (fictional vendor)",
  });
  const id: bigint = await readLedger.nextProposalId();
  await tx(`propose PayVendor ₹55,000 waterproofing → proposal ${id}`,
    ledgerAt(cast.MEERA).propose(societyId, 0, contractor, inrToWei(inr), docHash, "civil", "0x"));
  if (Number((await readLedger.getProposal(id)).tier) !== 2) throw new Error(`proposal ${id} is not tier 2; residents would not vote`);
  // Approve only after the AI has attested: a flag resets approvals and then asks every approver for a written reason.
  await waitFor("AI agent attests the invoice", async () => (await readLedger.getProposal(id)).attested, 90).catch(() => log("  (no attestation; continuing after the attest timeout)"));
  for (const member of ["MEERA", "C3", "C4", "ROHAN"] as const) {
    const p = await readLedger.getProposal(id);
    if (Number(p.status) !== 0) break;
    if (await readLedger.hasApproved(id, cast[member].address)) continue;
    const reason = p.flagged
      ? await manifest(cast[member], { schema: "nestledger.note.v1", createdAt: now(), purpose: "override", refs: [`proposal:${id}`],
          text: `Committee member ${member} (scripted): the terrace leaks every monsoon; sending it to the residents to decide.` })
      : ZERO_HASH;
    await tx(`approve (${member}${p.flagged ? ", with override reason" : ""})`, ledgerAt(cast[member]).approve(id, reason));
  }
  // Tier 2: after the committee approves, the residents vote. Scripted owners (flat labels are public, names are not).
  for (const [flatId, owner, support] of [[1n, "PRIYA", false], [2n, "ROHAN", false], [6n, "C5", false], [4n, "C3", true], [5n, "C4", true]] as const) {
    await tx(`castVote flat ${flatId} (${owner}) ${support ? "for" : "against"}`, ledgerAt(cast[owner]).castVote(id, flatId, support));
  }
  await waitFor("vote closes; keeper marks it Rejected", async () => Number((await readLedger.getProposal(id)).status) === 3, 300);
  log(`  proposal ${id} rejected by the residents (3 against, 2 for); the ₹55,000 reservation is released`);
}

const COMPACT = [
  ["living", "living-wide", "living"], ["kitchen", "kitchen-counter", "kitchen"], ["bedroom1", "bed1-wall", "bedroom"], ["bathroom1", "bath1-fittings", "bath"],
] as const;
// Prepared move-in images (AI-generated, visibly labelled). Each demo lease gets its own set (demo-photos/set-N,
// cropped differently) so reuse detection never links one lease's photos to another's; the live demo uploads
// the same set's after-*.jpg.
const DEMO_PHOTOS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "demo-photos");

/** The demo leases: ROHAN rents to each tenant; lease 1 is the society flat B-304. */
const DEMO_LEASES: { tenant: keyof typeof cast; flat: string | null; photos: string }[] = [
  { tenant: "ASHA", flat: "B-304", photos: "set-1" },
  { tenant: "PRIYA", flat: null, photos: "set-2" },
  { tenant: "IMRAN", flat: null, photos: "set-3" },
  { tenant: "C5", flat: null, photos: "set-4" },
];

/** Step 6: every demo lease pre-staged up to "move-out"; `--tenants=PRIYA,C5` limits it. */
async function seedLeases(flats: Record<string, bigint>) {
  const only = process.argv.find((a) => a.startsWith("--tenants="))?.split("=")[1].split(",");
  const staged: { leaseId: bigint; tenant: string; photos: string }[] = [];
  for (const d of DEMO_LEASES.filter((d) => !only || only.includes(d.tenant))) {
    const leaseId = await stageLease(flats, d.tenant, d.flat, d.photos);
    if (leaseId) staged.push({ leaseId, tenant: d.tenant, photos: d.photos });
  }
  log("\n[leases] ROHAN stays silent; the keeper presumes each baseline after the window (G1)");
  for (const s of staged) {
    await waitFor(`keeper → finalizeBaseline lease ${s.leaseId}`, async () => Number((await readRental.getLease(s.leaseId)).baseline) === 4, 240);
  }
  for (const s of staged) log(`  lease ${s.leaseId}: tenant ${s.tenant}, move-out uploads demo-photos/${s.photos}/after-*.jpg`);
  return staged;
}

async function stageLease(flats: Record<string, bigint>, tenantName: keyof typeof cast, flat: string | null, photos: string): Promise<bigint | null> {
  const tenant = cast[tenantName];
  log(`\n[lease] ROHAN offers ${flat ?? "a flat outside the society"} to ${tenantName} (photos ${photos})`);
  const rent = inrToWei(30_000), deposit = inrToWei(180_000);
  // Resume a lease this seed already offered (e.g. after a failed run); skip one that is already staged.
  let leaseId: bigint = await readRental.nextId();
  for (const id of (await readRental.agreementsOf(tenant.address)) as bigint[]) {
    const L = await readRental.getLease(id);
    if (L.landlord !== cast.ROHAN.address) continue;
    // Offered, or signed but without a move-in baseline yet (a run that stopped part-way).
    if (Number(L.status) === 0 || (Number(L.status) === 1 && Number(L.baseline) === 0)) leaseId = id;
    else if (Number(L.status) === 1) { log(`  = lease ${id} is already staged`); return null; }
  }
  const resuming = leaseId < (await readRental.nextId());
  const termsHash = await manifest(cast.ROHAN, {
    schema: "nestledger.lease-terms.v1", createdAt: now(), flatLabel: flat ?? `Demo flat for ${tenantName}`, rentINR: 30_000, maintenanceINR: flat ? 2_000 : 0,
    depositINR: 180_000, depositMonths: 6, periodDays: W.period / 86400, periods: W.periods, graceDays: W.grace / 86400,
    houseRules: ["No structural changes", "Pets allowed with notice"], inspectionTemplate: "compact",
  });
  if (resuming) log(`  = resuming lease ${leaseId} (already offered)`);
  else await tx(`offerLease → lease ${leaseId}`, rentalAt(cast.ROHAN).offerLease({
    tenant: tenant.address, flatId: flat ? flats[flat] : 0n, rent, deposit, useTrustPricing: false, baseDepositMonths: 6,
    period: W.period, periods: W.periods, grace: W.grace, baselineWindow: W.baselineWindow, claimWindow: W.claimWindow,
    responseWindow: W.responseWindowLease, termsHash,
  }));
  if (Number((await readRental.getLease(leaseId)).status) === 0) {
    await tx(`signLease (deposit ${formatAmount(deposit)})`, rentalAt(tenant).signLease(leaseId, { value: deposit }));
  }
  // Pay both periods now: period 0 is due at signing (+30 s grace) and paying early counts as on time.
  // Paying after the baseline wait would record a permanent late payment and block the tenant from Tier 3.
  // Explicit gas: a load-balanced RPC can estimate against the state before the previous payment and run out of gas.
  const due = rent + (flat ? MAINTENANCE : 0n);
  for (let k = Number((await readRental.getLease(leaseId)).paidPeriods); k < W.periods; k++) {
    await tx(`payRent period ${k}`, rentalAt(tenant).payRent(leaseId, { value: due, gasLimit: 400_000 }));
  }

  // Move-in baseline: the set's 4 prepared images, uploaded (labelled "not live camera") → bundle → AI move-in report → submitBaseline.
  const items = [];
  for (const [room, vantageId, file] of COMPACT) {
    const up = await upload(tenant, fs.readFileSync(path.join(DEMO_PHOTOS, photos, `before-${file}.jpg`)), {
      context: { type: "lease", id: leaseId.toString(), stage: "move-in" }, kind: "photo", room, vantageId, captureMode: "upload",
    });
    items.push(bundleItem(up, { kind: "photo", room, vantageId, captureMode: "upload" }));
  }
  const bundleHash = await manifest(tenant, {
    schema: "nestledger.bundle.v1", context: { type: "lease", id: leaseId.toString(), stage: "move-in" },
    createdBy: tenant.address.toLowerCase(), createdAt: now(), items,
  });
  const { reportHash } = await api(tenant, "/ai/move-in", { leaseId: leaseId.toString(), bundleHash });
  await tx(`submitBaseline (${tenantName} documents move-in)`, rentalAt(tenant).submitBaseline(leaseId, bundleHash, reportHash));
  return leaseId;
}

/** Step 7: ROHAN's 3-milestone kitchen project with IMRAN; milestone 0 approved, the demo continues at milestone 1. */
async function seedKitchen() {
  log("\n[kitchen] ROHAN renovates with IMRAN");
  const projectId: bigint = await readMilestone.nextId();
  const ctx = { type: "project", id: projectId.toString() };
  const plan = [
    { title: "Demolition", items: [["Remove old cabinets and countertop", 12_000], ["Debris removal", 8_000]] },
    { title: "Civil + electrical", items: [["Rewire kitchen points (6)", 25_000], ["Wall tiling behind counter", 15_000]] },
    { title: "Finishing", items: [["Modular cabinets install", 20_000], ["Paint and handover clean", 10_000]] },
  ] as const;

  const specHashes: `0x${string}`[] = [];
  const inputs = [];
  for (const [mi, m] of plan.entries()) {
    const vantages = [`kitchen-m${mi}-wide`, `kitchen-m${mi}-counter`];
    const refs = [];
    for (const [vi, v] of vantages.entries()) {
      refs.push(await upload(cast.ROHAN, await demoPhoto(`Kitchen reference · ${m.title} · ${v}`, 5000 + mi * 31 + vi * 7), {
        context: { ...ctx, stage: "design-ref" }, kind: "design", vantageId: v, captureMode: "upload",
      }));
    }
    const specHash = await manifest(cast.ROHAN, {
      schema: "nestledger.milestone-spec.v1", createdAt: now(), title: m.title,
      lineItems: m.items.map(([d, inr], index) => ({
        index, description: d, amountWei: inrToWei(inr).toString(), amountINR: inr, acceptance: [`${d} complete and visible in photos`],
      })),
      checklist: [{ itemId: "clean", text: "Site left clean" }, { itemId: "safe", text: "No exposed wiring" }],
      vantagePoints: vantages.map((id, i) => ({ id, description: `${m.title}: ${id}`, referenceImageHash: refs[i].hash })),
      designRefs: refs.map((r) => r.hash),
    });
    specHashes.push(specHash);
    inputs.push({
      title: m.title, lineItems: m.items.map(([, inr]) => inrToWei(inr)), advanceBps: 3000,
      duration: W.milestoneDuration, specHash,
    });
  }
  const projectSpec = await manifest(cast.ROHAN, {
    schema: "nestledger.project-spec.v1", createdAt: now(), title: "Kitchen renovation, B-304",
    scope: "Strip and rebuild the kitchen: electrical, tiling, modular cabinets.", siteLabel: "B-304",
    location: BENGALURU, warrantyDays: 180, milestoneSpecHashes: specHashes,
  });
  const total = inputs.reduce((s, m) => s + m.lineItems.reduce((a, b) => a + b, 0n), 0n);
  await tx(`createProject → project ${projectId} (${formatAmount(total)})`, milestoneAt(cast.ROHAN).createProject({
    contractor: cast.IMRAN.address, specHash: projectSpec, responseWindow: W.responseWindowProject,
    reworkWindow: W.reworkWindow, minScore: W.minScore, maxRounds: W.maxRounds, payerRef: 0, flatId: 0,
  }, inputs, { value: total }));
  await tx("acceptProject (IMRAN; materials advance paid)", milestoneAt(cast.IMRAN).acceptProject(projectId));

  // Milestone 0: site photos at the spec's vantage points → AI preview → claim → ROHAN approves.
  const items = [];
  for (const [vi, v] of ["kitchen-m0-wide", "kitchen-m0-counter"].entries()) {
    const capturedAt = now();
    const up = await upload(cast.IMRAN, await demoPhoto(`Kitchen site · Demolition done · ${v}`, 9000 + vi * 13), {
      context: { ...ctx, stage: "milestone" }, kind: "photo", vantageId: v, captureMode: "live", capturedAt,
      geo: { ...BENGALURU, acc: 12 },
    });
    items.push(bundleItem(up, { kind: "photo", vantageId: v, milestoneIndex: 0, captureMode: "live", capturedAt, geo: { ...BENGALURU, acc: 12 } }));
  }
  const photosBundleHash = await manifest(cast.IMRAN, {
    schema: "nestledger.bundle.v1", context: { ...ctx, stage: "milestone" }, createdBy: cast.IMRAN.address.toLowerCase(),
    createdAt: now(), items,
  });
  const preview = await api(cast.IMRAN, "/ai/milestone/preview", { projectId: projectId.toString(), milestoneIndex: 0, bundleHash: photosBundleHash });
  const claim = inputs[0].lineItems;
  const claimHash = await manifest(cast.IMRAN, {
    schema: "nestledger.claim.milestone.v1", createdAt: now(), projectId: projectId.toString(), milestoneIndex: 0, round: 0,
    photosBundleHash, previewReportHash: preview.reportHash,
    lineItems: claim.map((w, index) => ({ index, claimedWei: w.toString() })),
  });
  await tx("submitClaim milestone 0 (IMRAN)", milestoneAt(cast.IMRAN).submitClaim(projectId, claim, claimHash));
  await waitFor("AI agent attests milestone 0", async () => (await readMilestone.getAttestation(projectId, 0)).attestedAt > 0n, 180);
  await tx("respond(0): ROHAN approves; milestone 1 opens with its advance", milestoneAt(cast.ROHAN).respond(projectId, 0));
  log(`  project ${projectId} continues at milestone 1 in the live demo`);
  return projectId;
}

async function main() {
  if (!deployed?.SocietyLedger || !deployed.RentalEscrow || !deployed.MilestoneEscrow) throw new Error("v2 contracts are not in @nestledger/shared addresses");
  const health = await (await fetch(`${API}/health`)).json().catch(() => null);
  if (!health?.rpcOk) throw new Error(`backend not reachable at ${API}; start it first (pnpm --filter @nestledger/backend start)`);
  log(`Seeding chain ${config.chainId} via ${API} (AI: ${health.llm})`);

  const { societyId, flats } = await seedSociety();
  if (!ONLY || ONLY === "history") await seedHistory(societyId);
  if (!ONLY || ONLY === "declined") await seedDeclined(societyId);
  const leases = !ONLY || ONLY === "lease" ? await seedLeases(flats) : [];
  // BuildSafe is out of the demo (team decision); run --only=kitchen to seed the renovation project anyway.
  const projectId = ONLY === "kitchen" ? await seedKitchen() : undefined;

  log("\nSeed complete.");
  log(`  public dashboard   ${config.publicWebOrigin}/public/society/${societyId}`);
  for (const l of leases) log(`  lease (${l.tenant.padEnd(5)})      ${config.publicWebOrigin}/rent/${l.leaseId}   upload demo-photos/${l.photos}/after-*.jpg`);
  if (projectId) log(`  kitchen project    ${config.publicWebOrigin}/build/${projectId}`);
}

main().catch((err) => {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
});
