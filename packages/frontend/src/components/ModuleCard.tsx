"use client";

import Link from "next/link";
import { useCanOfferLease } from "@/hooks/useCanOfferLease";

type Module = { name: string; who: string; text: string; href: string; cta: string; icon: string; offersLease?: boolean };

/** Home-page product card. The DepositLock card only says "Offer a lease" to landlords and flat owners. */
export function ModuleCard({ m }: { m: Module }) {
  const canOffer = useCanOfferLease();
  const [href, cta] = m.offersLease && !canOffer ? ["/dashboard", "Your rentals"] : [m.href, m.cta];
  return (
    <Link href={href} className="card card-hover group flex flex-col gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-light text-accent-dark">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={m.icon} />
        </svg>
      </span>
      <div>
        <h3 className="font-semibold text-slate-900">{m.name}</h3>
        <p className="text-xs font-medium text-slate-500">{m.who}</p>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-slate-600">{m.text}</p>
      <span className="text-sm font-medium text-accent group-hover:underline">{cta} →</span>
    </Link>
  );
}
