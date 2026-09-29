import Link from "next/link";
import { ModuleCard } from "@/components/ModuleCard";

const MODULES = [
  {
    name: "DepositLock",
    who: "Tenants and landlords",
    text: "The deposit sits in a contract, not the landlord's account. Deductions are itemised, AI-checked against move-in photos, and disputed item by item.",
    href: "/rent/new",
    cta: "Offer a lease",
    offersLease: true,
    icon: "M3 11.5 12 4l9 7.5M5.5 10v10h13V10M10 20v-5h4v5",
  },
  {
    name: "SocietyLedger",
    who: "Apartment associations",
    text: "Maintenance funds live in a public treasury. Every bill is AI-checked for anomalies, approved by tier, and visible to every resident.",
    href: "/public/society/1",
    cta: "See a live treasury",
    icon: "M4 20h16M6 20V10m4 10V10m4 10V10m4 10V10M3 10l9-6 9 6",
  },
];

const PRIMITIVE = [
  ["Claim", "The payee claims itemised amounts against the escrowed money."],
  ["AI attests", "The AI agent states how much of each item the evidence supports."],
  ["Respond", "The payer accepts, or disputes specific items with a bond."],
  ["Silence rule", "No answer? AI-backed items pay out; the rest escalate."],
  ["Arbiters", "Three independent arbiters rule on each disputed item."],
  ["Payout", "The contract pays both sides. Nobody else can touch the funds."],
];

const EXAMPLE = [
  { item: "Repaint living-room wall", amount: "₹6,000", tone: "good", note: "AI-backed" },
  { item: "Cracked kitchen tile", amount: "₹4,500", tone: "warn", note: "Disputed → arbiters" },
  { item: "Normal wear on the floor", amount: "₹0", tone: "muted", note: "Never deductible" },
] as const;

export default function Home() {
  return (
    <div className="space-y-16 sm:space-y-20">
      <section className="grid items-center gap-10 pt-2 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <span className="chip bg-white py-1 text-accent-dark shadow-sm ring-1 ring-inset ring-accent/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live on MST Testnet
          </span>
          <h1 className="text-4xl font-bold leading-[1.1] text-slate-900 sm:text-5xl">
            The trust layer for <span className="bg-gradient-to-r from-accent to-emerald-500 bg-clip-text text-transparent">home living</span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            In Bengaluru, rent deposits and society maintenance funds are handed to the party who wants the money,
            with no neutral record of what was agreed or delivered. NestLedger holds that money in smart contracts on MST
            Blockchain until the agreed condition is met and verified.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/public/society/1" className="btn-primary px-5 py-2.5">See a public society ledger →</Link>
            <Link href="/dashboard" className="btn-secondary px-5 py-2.5">Open your dashboard</Link>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
            <li>✓ No wallet needed for the public ledger</li>
            <li>✓ Contracts verified on MSTScan</li>
            <li>✓ Non-custodial escrow</li>
          </ul>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-3xl bg-gradient-to-br from-accent/15 via-emerald-200/20 to-transparent blur-2xl" aria-hidden />
          <div className="card space-y-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Deposit claim</p>
                <p className="mt-1 font-semibold text-slate-900">Flat B-304 · move-out</p>
              </div>
              <span className="chip bg-purple-100 text-purple-800" title="An illustration, not live data">◇ Example</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {EXAMPLE.map((x) => (
                <li key={x.item} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-800">{x.item}</p>
                    <p className={`text-xs ${x.tone === "good" ? "text-accent-dark" : x.tone === "warn" ? "text-amber-700" : "text-slate-400"}`}>{x.note}</p>
                  </div>
                  <span className="font-mono text-sm tabular-nums text-slate-700">{x.amount}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <div className="mb-2 flex justify-between"><span>Deposit</span><span className="font-mono">₹1,80,000</span></div>
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="bg-accent" style={{ width: "94.2%" }} />
                <div className="bg-amber-400" style={{ width: "2.5%" }} />
                <div className="bg-slate-400" style={{ width: "3.3%" }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />Back to tenant</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" />With arbiters</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-400" />To landlord</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <p className="eyebrow">Two products</p>
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">Wherever money changes hands at home</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {MODULES.map((m) => <ModuleCard key={m.name} m={m} />)}
        </div>
      </section>

      <section className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <p className="eyebrow">One primitive</p>
          <h2 className="text-2xl font-bold text-slate-900 sm:text-3xl">How every payout settles</h2>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRIMITIVE.map(([title, text], i) => (
            <li key={title} className="card flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white shadow-sm shadow-accent/30">
                {i + 1}
              </span>
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">{title}</p>
                <p className="text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-accent-dark via-accent to-emerald-600 p-6 text-white shadow-lg shadow-accent/20 sm:p-10">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">The AI never moves money on its own.</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">
              It only decides whether silence counts as consent. People decide every contested amount, and nobody (not even us) can
              withdraw escrowed funds.
            </p>
          </div>
          <Link href="/status" className="btn bg-white px-5 py-2.5 text-accent-dark shadow-sm hover:bg-accent-light">
            Check the live system →
          </Link>
        </div>
      </section>
    </div>
  );
}
