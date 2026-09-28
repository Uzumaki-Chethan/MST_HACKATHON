// Creates the SPEC §11.1 demo-cast wallets and appends their keys to the repo-root .env.local
// (gitignored). Prints only public addresses. Refuses to overwrite keys that already exist.
// Run: pnpm --filter @nestledger/contracts exec hardhat run scripts/make-wallets.ts
import fs from "fs";
import path from "path";
import { Wallet } from "ethers";

const ENV = path.join(__dirname, "..", "..", "..", ".env.local");

// [alias, env var holding the private key, tMSTC it needs (§11.1)]
const CAST: [string, string, number][] = [
  ["ADMIN", "PRIVATE_KEY", 0.3],
  ["AGENT", "ATTESTOR_PRIVATE_KEY", 0.2],
  ["KEEPER", "KEEPER_PRIVATE_KEY", 0.5],
  ["MEERA", "MEERA_PRIVATE_KEY", 0.2],
  ["ROHAN", "ROHAN_PRIVATE_KEY", 0.8],
  ["ASHA", "ASHA_PRIVATE_KEY", 0.4],
  ["PRIYA", "PRIYA_PRIVATE_KEY", 0.05],
  ["C3", "C3_PRIVATE_KEY", 0.05],
  ["C4", "C4_PRIVATE_KEY", 0.05],
  ["C5", "C5_PRIVATE_KEY", 0.05],
  ["IMRAN", "IMRAN_PRIVATE_KEY", 0.05],
  ["PLUMBER", "PLUMBER_PRIVATE_KEY", 0],
  ["TANKER", "TANKER_PRIVATE_KEY", 0],
  ["ARB1", "ARB1_PRIVATE_KEY", 0.05],
  ["ARB2", "ARB2_PRIVATE_KEY", 0.05],
  ["ARB3", "ARB3_PRIVATE_KEY", 0.05],
  ["DEVICE_1", "DEVICE_KEY_DEVICE_1", 0],
];

const existing = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
const has = (k: string) => new RegExp(`^${k}=0x[0-9a-fA-F]{64}\\s*$`, "m").test(existing);
const keyOf = (k: string) => existing.match(new RegExp(`^${k}=(0x[0-9a-fA-F]{64})`, "m"))?.[1];

let out = existing && !existing.endsWith("\n") ? "\n" : "";
out += `\n# --- Demo cast wallets (SPEC §11.1), generated ${new Date().toISOString()} ---\n`;
const addr: Record<string, string> = {};
for (const [alias, envKey] of CAST) {
  if (has(envKey)) {
    addr[alias] = new Wallet(keyOf(envKey)!).address;
    continue;
  }
  const w = Wallet.createRandom();
  addr[alias] = w.address;
  out += `${envKey}=${w.privateKey}\n`;
}
// Addresses the deploy script and backend read (public, not secret).
for (const [k, v] of [
  ["ATTESTOR_ADDRESS", addr.AGENT], ["ARBITER_1", addr.ARB1], ["ARBITER_2", addr.ARB2], ["ARBITER_3", addr.ARB3],
  ["DEVICE_1_ADDRESS", addr.DEVICE_1],
]) {
  if (!new RegExp(`^${k}=0x`, "m").test(existing)) out += `${k}=${v}\n`;
}
fs.writeFileSync(ENV, existing + out);

console.log("\nAlias      Address                                     Needs tMSTC");
for (const [alias, , need] of CAST) console.log(`${alias.padEnd(10)} ${addr[alias]}  ${need}`);
const total = CAST.reduce((s, [, , n]) => s + n, 0);
console.log(`\nTotal needed: ${total.toFixed(2)} tMSTC. Keys are in ${ENV} (gitignored).`);
