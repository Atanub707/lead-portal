export function ScoreBadge({
  score,
  grade,
  compact = false,
}: {
  score: number | null | undefined;
  grade: string | null | undefined;
  compact?: boolean;
}) {
  if (score === null || score === undefined || !grade) {
    return <span className="text-[12px] text-zinc-300">—</span>;
  }
  const palette: Record<string, string> = {
    A: "border-emerald-200 bg-emerald-50 text-emerald-700",
    B: "border-sky-200 bg-sky-50 text-sky-700",
    C: "border-amber-200 bg-amber-50 text-amber-700",
    D: "border-zinc-200 bg-zinc-50 text-zinc-600",
    excluded: "border-rose-200 bg-rose-50 text-rose-700",
  };
  const tone = palette[grade] ?? palette.D;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${tone}`}
      title={`Lead score ${score}/100 (grade ${grade})`}
    >
      {grade === "excluded" ? "Excluded" : grade}
      {grade === "excluded" ? null : (
        <>
          <span className="text-[10px] opacity-60">·</span>
          {score}
        </>
      )}
      {compact ? null : <span className="sr-only">/100</span>}
    </span>
  );
}
