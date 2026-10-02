"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="card max-w-lg p-6" role="alert">
        <h1 className="text-base font-semibold tracking-tight text-zinc-900">
          Something went wrong
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          This page failed to render. It is usually temporary — try again.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[12px] text-zinc-400">
            Reference: {error.digest}
          </p>
        ) : null}
        <button onClick={reset} className="btn-primary mt-4">
          Try again
        </button>
      </div>
    </div>
  );
}
