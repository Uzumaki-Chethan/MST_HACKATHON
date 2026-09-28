import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ConnectBridgeKey } from "@/components/ConnectBridgeKey";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "NestLedger",
  description: "Rent deposits, society funds and renovations held by smart contracts on MST Blockchain.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <header className="border-b border-slate-200">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link href="/" className="text-lg font-bold text-slate-900">
                Nest<span className="text-accent">Ledger</span>
              </Link>
              <nav className="flex gap-4 text-sm text-slate-600">
                <Link href="/dashboard" className="hover:text-accent">Dashboard</Link>
                <Link href="/arbiter" className="hover:text-accent">Arbiter</Link>
                <Link href="/public/society/1" className="hover:text-accent">Public ledger</Link>
                <Link href="/status" className="hover:text-accent">Status</Link>
              </nav>
              <ConnectBridgeKey />
            </div>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-500">
            Runs on MST Testnet (chain 91562037). INR amounts are shown at a labelled demo rate.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
