"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectBridgeKey } from "./ConnectBridgeKey";

const NAV = [
  { href: "/dashboard", label: "Dashboard", match: ["/dashboard", "/rent", "/build", "/society", "/onboard", "/passport"] },
  { href: "/arbiter", label: "Arbiter", match: ["/arbiter"] },
  { href: "/public/society/1", label: "Public ledger", match: ["/public"] },
  { href: "/status", label: "Status", match: ["/status"] },
];

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#0F766E" />
      <path d="M7 16.5 16 9l9 7.5" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 15v8h11v-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" />
    </svg>
  );
}

export function SiteHeader() {
  const path = usePathname() ?? "/";
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Nest<span className="text-accent">Ledger</span>
          </span>
        </Link>
        <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto pb-0.5 md:order-none md:mx-0 md:w-auto md:pb-0">
          {NAV.map((n) => {
            const active = n.match.some((m) => path === m || path.startsWith(`${m}/`));
            return (
              <Link key={n.href} href={n.href} className={`nav-link ${active ? "nav-link-active" : ""}`} aria-current={active ? "page" : undefined}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <ConnectBridgeKey />
        </div>
      </div>
    </header>
  );
}
