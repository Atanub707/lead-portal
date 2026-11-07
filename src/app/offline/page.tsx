export const metadata = {
  title: "Offline · Lead Portal",
};

export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="card w-full max-w-sm p-6 text-center">
        <p className="text-[15px] font-semibold text-zinc-900">
          You&apos;re offline
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Lead Portal needs a connection to load live companies, emails and
          replies. Reconnect and try again.
        </p>
        <a href="/dashboard" className="btn-primary mt-4 inline-flex">
          Try again
        </a>
      </div>
    </div>
  );
}
