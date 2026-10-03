export default function Loading() {
  const bar = "animate-pulse rounded bg-zinc-200/70 motion-reduce:animate-none";
  const line = "animate-pulse rounded bg-zinc-100 motion-reduce:animate-none";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className={`h-5 w-32 ${bar}`} />

      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="card p-5">
            <div className="flex items-start justify-between">
              <div className={`h-3 w-20 ${line}`} />
              <div className={`h-7 w-7 rounded-lg ${line}`} />
            </div>
            <div className={`mt-3 h-7 w-14 ${bar}`} />
            <div className={`mt-2 h-3 w-24 ${line}`} />
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="card h-96 animate-pulse bg-zinc-100/60 motion-reduce:animate-none" />
        <div className="card h-96 animate-pulse bg-zinc-100/60 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
