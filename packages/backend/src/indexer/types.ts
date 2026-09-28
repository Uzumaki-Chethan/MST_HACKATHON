// SPEC §6.8 (frozen). Shared with the AI agent (Laptop 2).
import { EventEmitter } from "node:events";

export type IndexedEvent = {
  contract: string;                              // "RentalEscrow", "SocietyLedger", ...
  name: string;                                  // event name, e.g. "ClaimSubmitted"
  args: Record<string, string | string[]>;       // bigints as decimal strings
  blockNumber: number;
  txHash: string;
  logIndex: number;
  timestamp: number;                             // block time, unix seconds
};

export interface IndexerEvents extends EventEmitter {
  on(event: "event", listener: (e: IndexedEvent) => void): this;
  emit(event: "event", e: IndexedEvent): boolean;
}
