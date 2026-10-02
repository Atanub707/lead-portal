import {
  KIND_LABEL,
  STATUS_LABEL,
  type OrgKind,
  type PipelineStage,
} from "@/lib/types";

const STATUS_STYLES: Record<PipelineStage, string> = {
  new: "bg-slate-100 text-slate-700 ring-slate-200",
  contacted: "bg-blue-50 text-blue-700 ring-blue-200",
  demo: "bg-violet-50 text-violet-700 ring-violet-200",
  scoping: "bg-violet-50 text-violet-700 ring-violet-200",
  proposal: "bg-amber-50 text-amber-700 ring-amber-200",
  won: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  lost: "bg-rose-50 text-rose-700 ring-rose-200",
};

const KIND_STYLES: Record<OrgKind, string> = {
  lead: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partner: "bg-sky-50 text-sky-700 ring-sky-200",
  competitor: "bg-rose-50 text-rose-700 ring-rose-200",
  other: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function StatusPill({ status }: { status: PipelineStage }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function KindBadge({ kind }: { kind: OrgKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${KIND_STYLES[kind]}`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}
