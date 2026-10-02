import {
  KIND_LABEL,
  STATUS_LABEL,
  type OrgKind,
  type PipelineStage,
} from "@/lib/types";

const STATUS_DOT: Record<PipelineStage, string> = {
  new: "bg-zinc-300",
  contacted: "bg-blue-500",
  demo: "bg-violet-500",
  scoping: "bg-violet-500",
  proposal: "bg-amber-500",
  won: "bg-emerald-500",
  lost: "bg-rose-400",
};

export function StatusDot({ status }: { status: PipelineStage }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-zinc-700">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

const KIND_PILL: Record<OrgKind, string> = {
  lead: "bg-zinc-100 text-zinc-600",
  partner: "bg-sky-50 text-sky-700",
  competitor: "bg-rose-50 text-rose-700",
  other: "bg-zinc-100 text-zinc-600",
};

export function KindBadge({ kind }: { kind: OrgKind }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_PILL[kind]}`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

const AVATAR_STYLES = [
  "bg-rose-50 text-rose-700",
  "bg-amber-50 text-amber-700",
  "bg-emerald-50 text-emerald-700",
  "bg-sky-50 text-sky-700",
  "bg-violet-50 text-violet-700",
  "bg-zinc-100 text-zinc-600",
];

export function CompanyAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "md" | "sm";
}) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const style = AVATAR_STYLES[hash % AVATAR_STYLES.length];
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded font-semibold ${style} ${
        size === "sm" ? "h-5 w-5 text-[10px]" : "h-6 w-6 text-[11px]"
      }`}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
