import { auth } from "@clerk/nextjs/server";
import { Coins, Info } from "lucide-react";
import { SendPolicyForm } from "@/components/send-policy-form";
import { SendQueuePanel } from "@/components/send-queue-panel";
import { SendTicker } from "@/components/send-ticker";
import { activeWorkspaceId } from "@/lib/data";
import { getSendOverview } from "@/lib/send-queue";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function SendingPage() {
  const { userId } = await auth();
  const workspaceId = await activeWorkspaceId();
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId ?? "")
    .maybeSingle();
  const overview = userId
    ? await getSendOverview(workspaceId, userId)
    : null;
  const today = overview?.days[0] ?? null;
  const scheduledCount =
    overview?.queue.filter((item) => item.status === "scheduled").length ?? 0;

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Sending</h1>
        <p className="mt-1 max-w-[85ch] text-[13px] leading-relaxed text-zinc-500">
          One send coin is one human-approved email. Copilot mints a coin only
          after you review and approve a draft; the queue delivers it inside your
          safe window with a human-paced gap.
        </p>
      </header>

      {!overview?.available ? (
        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          <p className="font-medium">Sending needs the Phase 3 database tables.</p>
          <p className="mt-1">Apply <code className="font-mono">supabase/migrations/20261108120000_send_coins.sql</code> in the Supabase SQL editor, then reload this page.</p>
        </div>
      ) : null}

      {overview?.available && today ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Next send day</p>
            <p className="mt-1 text-[15px] font-semibold text-zinc-900">{today.date}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{today.warmup ? "Warm-up ramp" : "Established mailbox"}</p>
          </div>
          <div className="card p-4">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Send coins left</p>
            <p className="mt-1 text-[15px] font-semibold text-zinc-900 tabular-nums">{today.remaining} / {today.cap}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{today.scheduled} scheduled · {today.sent} sent</p>
          </div>
          <div className="card p-4">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Window</p>
            <p className="mt-1 text-[15px] font-semibold text-zinc-900">{overview.policy.window_start}–{overview.policy.window_end}</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{overview.policy.timezone}</p>
          </div>
          <div className="card p-4">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400">Per-domain cap</p>
            <p className="mt-1 text-[15px] font-semibold text-zinc-900">{overview.policy.domain_daily_cap}/day</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">{overview.policy.min_gap_minutes}–{overview.policy.max_gap_minutes} min between sends</p>
          </div>
        </div>
      ) : null}

      {overview?.available ? (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
              <p className="max-w-[80ch] text-[11px] leading-relaxed text-zinc-500">
                Background delivery calls <code className="font-mono">/api/sending/tick</code>.
                This page checks every minute while open; for closed-tab delivery,
                point a 5-minute cron at the endpoint with the CRON_SECRET bearer.
              </p>
            </div>
            <SendTicker available hasScheduled={scheduledCount > 0} />
          </div>

          <div className="mt-5 space-y-5">
            <SendPolicyForm policy={overview.policy} canEdit={profile?.role === "owner"} />
            <SendQueuePanel items={overview.queue} timezone={overview.policy.timezone} />
          </div>
        </>
      ) : null}

      {overview?.available && overview.days.length > 1 ? (
        <section className="card mt-5 p-5">
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            <h2 className="text-[14px] font-semibold text-zinc-900">Upcoming coin allowance</h2>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {overview.days.map((day) => (
              <div key={day.date} className="rounded-lg border border-zinc-100 px-3 py-2">
                <p className="text-[11px] font-medium text-zinc-800">{day.date}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500 tabular-nums">{day.remaining} of {day.cap} left</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
