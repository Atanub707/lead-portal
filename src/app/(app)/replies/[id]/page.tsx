import Link from "next/link";
import { notFound } from "next/navigation";
import { ReplyThread } from "@/components/reply-thread";
import { getCurrentProfile, getReplyThread } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ReplyThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const threadId = Number(id);
  if (!Number.isFinite(threadId)) notFound();

  const result = await getReplyThread(threadId);
  if (!result) notFound();

  const { thread, messages } = result;

  // Opening a conversation clears its unread count. Rows on the reply tables
  // are select-only for members, so this write goes through the service-role
  // client — always scoped to the signed-in owner of the thread.
  if (thread.unread > 0) {
    const profile = await getCurrentProfile();
    if (profile) {
      try {
        const admin = createAdminClient();
        const { error } = await admin
          .from("email_threads")
          .update({ unread: 0 })
          .eq("id", threadId)
          .eq("user_id", profile.id);
        if (error) {
          console.error("[replies] mark read failed:", error.message);
        }
      } catch (err) {
        console.error("[replies] mark read failed:", err);
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <Link
        href="/replies"
        className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
      >
        ← Replies
      </Link>

      <header className="mt-3">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          {thread.subject_norm}
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          {thread.counterparty_email}
        </p>
      </header>

      <div className="mt-6 max-w-[820px]">
        <ul className="space-y-3">
          {messages.map((message) => {
            const outbound = message.direction === "out";
            return (
              <li
                key={message.id}
                className={`flex ${outbound ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg border px-4 py-3 sm:max-w-[75%] ${
                    outbound
                      ? "border-zinc-200 bg-zinc-50"
                      : "border-zinc-200 bg-white"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                    <span className="truncate">
                      {outbound
                        ? `You → ${message.to_email}`
                        : message.from_email}
                    </span>
                    <span aria-hidden="true">·</span>
                    <time
                      dateTime={message.sent_at}
                      className="tabular-nums"
                    >
                      {new Date(message.sent_at).toISOString().slice(0, 10)}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-800">
                    {message.body}
                  </p>
                  {message.has_attachments ? (
                    <p className="mt-2 text-[11px] text-zinc-400">
                      Has attachment
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        <ReplyThread threadId={thread.id} />
      </div>
    </div>
  );
}
