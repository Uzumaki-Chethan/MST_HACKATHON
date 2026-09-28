// Typed wrappers for every backend endpoint in SPEC §7.3.
import type {
  InvoiceReport,
  MilestoneReport,
  MoveInReport,
  MoveOutReport,
} from "@nestledger/shared/schemas";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

let authToken: string | null = null;
export const setAuthToken = (t: string | null) => {
  authToken = t;
};

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

type Hex = `0x${string}`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(res.status, err.code ?? String(res.status), err.message ?? res.statusText);
  }
  return body as T;
}

const post = <T>(path: string, data: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(data) });

// --- auth (§7.2)
export const getNonce = () => request<{ nonce: string }>("/auth/nonce");
export const verifySiwe = (message: string, signature: Hex) =>
  post<{ token: string; address: Hex }>("/auth/verify", { message, signature });

// --- evidence and manifests
export type EvidenceMeta = {
  context: { type: string; id: string; stage: string };
  kind: "photo" | "invoice" | "design" | "document";
  room?: string;
  vantageId?: string;
  captureMode: "live" | "upload";
  capturedAt?: string;
  geo?: { lat: number; lng: number; acc: number };
};
export type EvidenceChecks = {
  duplicateOf?: string;
  reusedOf?: string;
  nearDuplicateOf?: string;
  fresh?: boolean;
  stale?: boolean;
  geoOk?: boolean | null;
};
export type EvidenceUpload = { hash: Hex; mime: string; size: number; phash: string | null; checks: EvidenceChecks; url: string };

export function uploadEvidence(file: Blob, meta: EvidenceMeta, captureToken?: string) {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("file", file, "capture.jpg");
  const headers = captureToken ? { "X-Capture-Token": captureToken } : undefined;
  return request<EvidenceUpload>("/evidence", { method: "POST", body: form, headers });
}

/** Evidence needs the JWT, so <img src> can't load it directly: fetch it and use an object URL. */
export async function fetchEvidenceObjectUrl(hash: string): Promise<string> {
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
  const res = await fetch(`${API_URL}/evidence/${hash}`, { headers });
  if (!res.ok) throw new ApiError(res.status, String(res.status), "could not load evidence");
  return URL.createObjectURL(await res.blob());
}
export const publicEvidenceUrl = (hash: string) => `${API_URL}/evidence/${hash}`;

export const postManifest = (manifest: { schema: string }) => post<{ hash: Hex }>("/manifests", manifest);
export const getManifest = <T = unknown>(hash: string) => request<T>(`/manifests/${hash}`);
export const getReport = <T = unknown>(hash: string) => request<T>(`/reports/${hash}`);

// --- AI (WP-B)
export const aiMoveIn = (leaseId: string, bundleHash: Hex) =>
  post<{ report: MoveInReport; reportHash: Hex }>("/ai/move-in", { leaseId, bundleHash });
export const aiMoveOut = (leaseId: string, bundleHash: Hex) =>
  post<{ report: MoveOutReport; reportHash: Hex }>("/ai/move-out", { leaseId, bundleHash });
export const aiMilestonePreview = (projectId: string, milestoneIndex: number, bundleHash: Hex) =>
  post<{ report: MilestoneReport; reportHash: Hex; supportedPreview: string[] }>("/ai/milestone/preview", {
    projectId,
    milestoneIndex,
    bundleHash,
  });
export const aiInvoicePreview = (societyId: string, bundleHash: Hex, payee: Hex, amountWei: string) =>
  post<{ report: InvoiceReport; reportHash: Hex }>("/ai/invoice/preview", { societyId, bundleHash, payee, amountWei });

// --- indexer-backed reads
export type TimelineEntry = {
  contract?: string;
  name: string;
  args: Record<string, string | string[]>;
  txHash: Hex;
  blockNumber: number;
  timestamp: number;
};
export type TimelineContract = "rental" | "milestone" | "ledger" | "dispute";
export const getTimeline = (contract: TimelineContract, id: string | number) =>
  request<TimelineEntry[]>(`/timeline/${contract}/${id}`);
export const getMyFeed = () => request<TimelineEntry[]>("/me/feed");
export const getMyFlats = () =>
  request<{ flatId: string; societyId: string; label: string; maintenanceWei: string }[]>("/me/flats");

// --- capture sessions (P1)
export const createCaptureSession = (context: EvidenceMeta["context"], stage: string, template: "full" | "compact") =>
  post<{ token: string; url: string }>("/capture-sessions", { context, stage, template });
export const getCaptureSession = (token: string) =>
  request<{ uploads: { hash: Hex; room: string; vantageId: string; checks: EvidenceChecks }[] }>(
    `/capture-sessions/${token}`,
  );

// --- public (no auth). Shapes owned by WP-D (CLAUDE1.md, A3); amounts are decimal wei strings, addresses lowercase.
export type PublicSociety = {
  societyId: string;
  name: string;
  totals: {
    balanceWei: string; committedWei: string; availableWei: string; totalCollectedWei: string; totalSpentWei: string;
    collectedThisMonthWei: string; spentThisMonthWei: string;
  };
  monthly: { month: string; collectedWei: string; spentWei: string }[];
  spendByCategory: { category: string; spentWei: string }[];
  updatedAt: string;
};
export type PublicLedgerItem = {
  id: number; txHash: Hex; timestamp: number; direction: "in" | "out"; type: string; amountWei: string;
  proposalId?: string; invoiceFiles?: string[];
  approvers?: { member: string; overrideReasonHash: Hex | null; overrideText: string | null }[];
};
export const getPublicSociety = (id: string | number) => request<PublicSociety>(`/public/societies/${id}`);
export const getPublicSocietyLedger = (id: string | number, cursor?: number) =>
  request<{ items: PublicLedgerItem[]; nextCursor: number | null }>(`/public/societies/${id}/ledger${cursor ? `?cursor=${cursor}` : ""}`);
export type PublicPassport = {
  address: string;
  hasPassport: boolean;
  verified: boolean;
  kinds: number;
  registeredAt: number;
  tier: number;
  score: number;
  stats: Record<string, number>;
  recent: (TimelineEntry & { contract: string })[];
};
export const getPublicPassport = (address: string) => request<PublicPassport>(`/public/passport/${address}`);

// --- misc
export const gasDrip = () => post<{ txHash: Hex }>("/gas/drip", {});
export type Health = {
  rpcOk: boolean;
  block: number;
  attestorBalance: string;
  keeperBalance: string;
  llm: string;
  indexerLag: number;
};
export const getHealth = () => request<Health>("/health");
