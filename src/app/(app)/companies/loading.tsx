export default function Loading() {
  const bar = "animate-pulse rounded bg-zinc-200/70 motion-reduce:animate-none";
  const line = "animate-pulse rounded bg-zinc-100 motion-reduce:animate-none";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className={`h-5 w-44 ${bar}`} />
          <div className={`mt-2 h-3 w-24 ${line}`} />
        </div>
        <div className={`h-8 w-36 ${bar}`} />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className={`h-9 min-w-[200px] flex-1 ${line}`} />
        <div className={`h-9 w-28 ${line}`} />
        <div className={`h-9 w-32 ${line}`} />
        <div className={`h-9 w-32 ${line}`} />
      </div>

      <div className="card mt-5 overflow-hidden">
        {Array.from({ length: 9 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-zinc-100 px-3 py-3.5 last:border-0"
          >
            <div className={`h-4 w-4 rounded-full ${line}`} />
            <div className={`h-6 w-6 rounded ${bar}`} />
            <div className={`h-3.5 w-40 ${bar}`} />
            <div className={`ml-auto hidden h-3.5 w-24 sm:block ${line}`} />
            <div className={`hidden h-3.5 w-20 md:block ${line}`} />
            <div className={`h-3.5 w-16 ${line}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
