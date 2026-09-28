import { statusLabel, type StatusKind, type Tone } from "@/lib/labels";

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  waiting: "bg-amber-100 text-amber-800",
  good: "bg-accent-light text-accent-dark",
  bad: "bg-red-100 text-red-800",
  info: "bg-sky-100 text-sky-800",
};

/** Status in plain words. Pass `enumValues` when `value` is the on-chain number. */
export function StatusChip({ kind, value, enumValues }: { kind: StatusKind; value: string | number; enumValues?: readonly string[] }) {
  const [text, tone] = statusLabel(kind, value, enumValues);
  return <span className={`chip ${TONE[tone]}`}>{text}</span>;
}

export function RoleBadge({ role }: { role: string }) {
  return <span className="chip bg-slate-100 capitalize text-slate-700">{role}</span>;
}

/** SPEC §8.6 rule 4: anything automated or simulated carries a badge. */
export function SimulatedBadge({ what }: { what: "Keeper" | "AI agent" | "Scripted actor" | "AI: fixture mode" }) {
  const simulated = what === "Scripted actor" || what === "AI: fixture mode";
  return (
    <span className={`chip ${simulated ? "bg-purple-100 text-purple-800" : "bg-sky-100 text-sky-800"}`} title={simulated ? "Simulated for the demo" : "Automated"}>
      {simulated ? "◇ " : "⚙ "}
      {what}
    </span>
  );
}
