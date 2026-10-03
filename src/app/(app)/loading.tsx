export default function Loading() {
  const bar = "animate-pulse rounded bg-zinc-200/70 motion-reduce:animate-none";
  const line = "animate-pulse rounded bg-zinc-100 motion-reduce:animate-none";

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className={`h-4 w-32 ${bar}`} />
      <div className={`mt-3 h-6 w-56 ${bar}`} />

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="card p-5">
              <div className={`h-3.5 w-24 ${bar}`} />
              <div className="mt-3 space-y-2">
                <div className={`h-3 w-full ${line}`} />
                <div className={`h-3 w-5/6 ${line}`} />
                <div className={`h-3 w-2/3 ${line}`} />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden space-y-5 lg:block">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="card h-48 animate-pulse bg-zinc-100/60 motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
