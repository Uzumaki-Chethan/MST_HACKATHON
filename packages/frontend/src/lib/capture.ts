// QR capture handoff (§8.4). GET /capture-sessions/:token needs the creator's login, so the phone can't
// read the session. The desktop puts what the phone needs (context + vantage points) in the URL fragment,
// which never reaches a server. The backend still enforces the token's context on every upload.
import type { Vantage } from "@nestledger/shared";
import type { Bundle } from "@nestledger/shared/schemas";

export type CapturePlan = { context: Bundle["context"]; vantages: Vantage[] };

export function encodePlan(plan: CapturePlan): string {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodePlan(fragment: string): CapturePlan | null {
  try {
    const b64 = fragment.replace(/^#/, "").replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const plan = JSON.parse(new TextDecoder().decode(bytes)) as CapturePlan;
    return plan?.context?.type && Array.isArray(plan.vantages) && plan.vantages.length ? plan : null;
  } catch {
    return null;
  }
}

export const CONTEXT_TEXT: Record<string, string> = { lease: "Rental", project: "Renovation project", proposal: "Proposal", society: "Society", order: "Order" };
