import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LogoMark, SiteHeader } from "@/components/SiteHeader";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "NestLedger",
  description: "Rent deposits, society funds and renovations held by smart contracts on MST Blockchain.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0F766E" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <SiteHeader />
          <main className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{children}</main>
          <footer className="mt-8 border-t border-slate-200/70 bg-white/60">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <LogoMark className="h-5 w-5" />
                <span>
                  Runs on <span className="font-medium text-slate-700">MST Testnet</span> (chain 91562037). INR amounts are shown at a labelled demo rate.
                </span>
              </div>
              <nav className="flex flex-wrap gap-4">
                <Link href="/public/society/1" className="hover:text-accent">Public ledger</Link>
                <Link href="/status" className="hover:text-accent">System status</Link>
                <a href="https://testnet.mstscan.com" target="_blank" rel="noreferrer" className="hover:text-accent">MSTScan ↗</a>
              </nav>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
