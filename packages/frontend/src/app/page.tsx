import Link from "next/link";

const MODULES = [
  {
    name: "DepositLock",
    who: "Tenants and landlords",
    text: "The deposit sits in a contract, not the landlord's account. Deductions are itemised, AI-checked against move-in photos, and disputed item by item.",
  },
  {
    name: "SocietyLedger",
    who: "Apartment associations",
    text: "Maintenance funds live in a public treasury. Every bill is AI-checked for anomalies, approved by tier, and visible to every resident.",
  },
  {
    name: "BuildSafe",
    who: "Homeowners and contractors",
    text: "Renovation budgets release milestone by milestone, with a materials advance for the contractor and protection for both sides.",
  },
];

const PRIMITIVE = [
  "Payee claims itemised amounts against escrowed money",
  "AI attests how much of each item the evidence supports",
  "Payer accepts or disputes per item",
  "Silence pays AI-backed items and escalates the rest",
  "Three arbiters rule per item",
  "The contract pays out",
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">The trust layer for home living</h1>
        <p className="max-w-2xl text-slate-600">
          In Bengaluru, deposits, society maintenance and renovation advances are handed to the party who wants the money,
          with no neutral record of what was agreed or delivered. NestLedger holds that money in smart contracts on MST
          Blockchain until the agreed condition is met and verified.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/public/society/1" className="btn-primary">See a public society ledger</Link>
          <Link href="/dashboard" className="btn-secondary">Open your dashboard</Link>
        </div>
        <p className="text-sm text-slate-500">The public ledger and passports need no wallet.</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {MODULES.map((m) => (
          <div key={m.name} className="card">
            <h2 className="font-semibold text-slate-900">{m.name}</h2>
            <p className="mb-2 text-xs uppercase tracking-wide text-accent">{m.who}</p>
            <p className="text-sm text-slate-600">{m.text}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-900">One primitive, three products</h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {PRIMITIVE.map((step, i) => (
            <li key={step} className="card flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
                {i + 1}
              </span>
              <span className="text-sm text-slate-700">{step}</span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-slate-600">
          The AI never moves money on its own. It only decides whether silence counts as consent. People decide every
          contested amount, and nobody (not even us) can withdraw escrowed funds.
        </p>
      </section>
    </div>
  );
}
