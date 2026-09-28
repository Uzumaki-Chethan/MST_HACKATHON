// SPEC §4.7. Every hash is keccak256 of raw bytes or of RFC 8785 canonical JSON.
import canonicalize from "canonicalize";
import { keccak256, toBytes } from "viem";

export type Hex32 = `0x${string}`;

export const ZERO_HASH: Hex32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

/** keccak256 of raw file bytes, lowercase 0x hex. */
export function hashBytes(bytes: Uint8Array): Hex32 {
  return keccak256(bytes);
}

/** keccak256(utf8(canonicalize(obj))): the manifest/report hash used on-chain. */
export function hashJson(obj: unknown): Hex32 {
  const text = canonicalize(obj);
  if (text === undefined) throw new Error("hashJson: value cannot be canonicalized");
  return keccak256(toBytes(text));
}

export const isHex32 = (s: string): s is Hex32 => /^0x[0-9a-f]{64}$/.test(s);
