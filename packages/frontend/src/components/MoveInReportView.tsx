import type { MoveInReport } from "@nestledger/shared/schemas";
import { SimulatedBadge } from "./Badges";

const COND: Record<string, string> = {
  good: "bg-accent-light text-accent-dark",
  minor_wear: "bg-amber-100 text-amber-800",
  damaged: "bg-red-100 text-red-800",
  missing: "bg-red-100 text-red-800",
  not_visible: "bg-slate-100 text-slate-600",
};
const COND_TEXT: Record<string, string> = {
  good: "Good", minor_wear: "Minor wear", damaged: "Damaged", missing: "Missing", not_visible: "Not visible",
};

export function MoveInReportView({ report }: { report: MoveInReport }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SimulatedBadge what={report.model === "fixtures" ? "AI: fixture mode" : "AI agent"} />
        <span className="text-sm text-slate-600">
          Overall: <span className="font-medium capitalize">{report.overallCondition}</span> · confidence {Math.round(report.confidence * 100)}%
        </span>
      </div>
      <p className="text-sm text-slate-700">{report.summary}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {report.rooms.map((r) => (
          <div key={r.room} className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium capitalize text-slate-800">{r.room}</p>
            <ul className="space-y-1">
              {r.elements.map((e) => (
                <li key={e.elementId} className="text-xs text-slate-700">
                  <span className={`chip mr-1 ${COND[e.condition]}`}>{COND_TEXT[e.condition]}</span>
                  <span className="font-medium">{e.element}</span>: {e.notes}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
