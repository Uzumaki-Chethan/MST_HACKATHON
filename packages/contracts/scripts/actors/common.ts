// Shared helpers for the scripted demo actors (SPEC §11.1: C3–C5 and ARB2–ARB3 are scripted, and say so).
// Keys come from the repo-root .env.local (loaded by hardhat.config.ts). The backend must be running,
// because written reasons are stored as note.v1 manifests there and only their hash goes on-chain.
import hre from "hardhat";
import fs from "fs";
import path from "path";
import type { Wallet } from "ethers";

const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments.json"), "utf8"));

export const API_URL = process.env.ACTOR_API_URL || "http://localhost:8080";
// Must be one of the backend's PUBLIC_WEB_ORIGIN hosts; start-public.ps1 always includes localhost:3000.
const SIWE_ORIGIN = "http://localhost:3000";

export const link = (hash: string) => `https://testnet.mstscan.com/tx/${hash}`;

export function addressOf(name: string): string {
  const addr = deployments[hre.network.name]?.[name]?.address;
  if (!addr) throw new Error(`No ${name} on ${hre.network.name}`);
  return addr;
}

export function actor(alias: string): Wallet {
  const key = process.env[`${alias}_PRIVATE_KEY`];
  if (!key) throw new Error(`${alias}_PRIVATE_KEY is missing from .env.local`);
  return new hre.ethers.Wallet(key, hre.ethers.provider);
}

/** Sign-In with Ethereum against the backend; returns a JWT. */
async function signIn(wallet: Wallet): Promise<string> {
  const { nonce } = await api("GET", "/auth/nonce");
  const message = [
    `${new URL(SIWE_ORIGIN).host} wants you to sign in with your Ethereum account:`,
    wallet.address,
    "",
    "NestLedger scripted demo actor",
    "",
    `URI: ${SIWE_ORIGIN}`,
    "Version: 1",
    `Chain ID: ${(await hre.ethers.provider.getNetwork()).chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const signature = await wallet.signMessage(message);
  const { token } = await api("POST", "/auth/verify", { message, signature });
  return token;
}

/** Stores a note.v1 manifest as `wallet` and returns its hash (what goes on-chain). */
export async function postNote(wallet: Wallet, purpose: string, text: string, refs: string[]): Promise<string> {
  const token = await signIn(wallet);
  const note = { schema: "nestledger.note.v1", createdAt: new Date().toISOString(), purpose, text, refs };
  const { hash } = await api("POST", "/manifests", note, token);
  return hash;
}

async function api(method: string, route: string, body?: unknown, token?: string): Promise<any> {
  const res = await fetch(API_URL + route, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}
