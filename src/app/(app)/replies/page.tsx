import Link from "next/link";
import { Mail } from "lucide-react";
import { SyncOnLoad } from "@/components/sync-on-load";
import { getReplyThreads } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const threads = await getReplyThreads();

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <SyncOnLoad />

      <header>
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Replies
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500 tabular-nums">
          {threads.length}{" "}
          {threads.length === 1 ? "conversation" : "conversations"}
        </p>
      </header>

      <div className="card mt-6 divide-y divide-zinc-100 overflow-hidden">
        {threads.map((thread) => {
          const snippet = thread.last_body?.split("\n")[0]?.trim() ?? "";
          const date = new Date(thread.last_message_at)
            .toISOString()
            .slice(0, 10);
          return (
            <Link
              key={thread.id}
              href={`/replies/${thread.id}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50"
            >
              <span className="pt-0.5">
                <Mail
                  className="h-4 w-4 text-zinc-300"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p
                    className={`truncate text-[13px] text-zinc-900 ${
                      thread.unread > 0 ? "font-medium" : ""
                    }`}
                  >
                    {thread.subject_norm}
                  </p>
                  {thread.org_name ? (
                    <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] text-zinc-500">
                      {thread.org_name}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[12px] text-zinc-500">
                  {thread.counterparty_email}
                </p>
                {snippet ? (
                  <p className="mt-1 truncate text-[12px] text-zinc-400">
                    {thread.last_direction === "out" ? "You: " : ""}
                    {snippet}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                {thread.unread > 0 ? (
                  <span
                    role="img"
                    aria-label="Unread"
                    className="h-1.5 w-1.5 rounded-full bg-zinc-900"
                  />
                ) : null}
                <time
                  dateTime={thread.last_message_at}
                  className="text-[12px] text-zinc-400 tabular-nums"
                >
                  {date}
                </time>
              </div>
            </Link>
          );
        })}

        {threads.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-[13px] text-zinc-500">
              No replies yet — emails you send from the portal and their replies
              appear here.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
