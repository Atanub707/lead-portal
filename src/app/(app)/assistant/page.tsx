import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatPanel } from "./chat-panel";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          AI Assistant
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          Paste company research, LinkedIn links, or member lists — say which
          list they belong to and the assistant documents them properly.
        </p>
        <ChatPanel />
      </div>
    </div>
  );
}
