import Link from "next/link";
import { getBillingOverview } from "@/lib/data";
import { BillingPanel } from "@/components/billing-panel";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const overview = await getBillingOverview();

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#F7F7F8] px-4 py-16">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-semibold tracking-tight text-zinc-900">
            Lead Portal
          </p>
          <Link
            href="/dashboard"
            className="text-[12px] text-zinc-500 transition-colors hover:text-zinc-800"
          >
            Back to app →
          </Link>
        </div>
        <div className="mt-6">
          <BillingPanel overview={overview} />
        </div>
      </div>
    </div>
  );
}
