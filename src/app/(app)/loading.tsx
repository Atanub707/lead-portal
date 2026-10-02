export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="h-6 w-44 animate-pulse rounded-md bg-zinc-200 motion-reduce:animate-none" />
      <div className="mt-2 h-4 w-28 animate-pulse rounded-md bg-zinc-100 motion-reduce:animate-none" />

      <div className="card mt-6 overflow-hidden">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="h-8 w-full max-w-md animate-pulse rounded-md bg-zinc-100 motion-reduce:animate-none" />
        </div>
        <div className="divide-y divide-zinc-100">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3.5">
              <div className="h-6 w-6 shrink-0 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none" />
              <div className="h-4 w-40 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none" />
              <div className="ml-auto h-4 w-24 animate-pulse rounded bg-zinc-100 motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
