import { explorerAddress, explorerTx } from "@nestledger/shared";

export const shortHex = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** Short hash linking to MSTScan. */
export function TxLink({ hash }: { hash: string }) {
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline hover:text-accent-dark">
      {shortHex(hash)} ↗ MSTScan
    </a>
  );
}

export function AddressLink({ address }: { address: string }) {
  return (
    <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="font-mono text-xs text-accent underline">
      {shortHex(address)}
    </a>
  );
}
