import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WelcomeForm } from "./welcome-form";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.onboarded) redirect("/dashboard");

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f7f7f8] px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-[13px] font-bold text-white">
            L
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            Welcome to Lead Portal
          </h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            You&apos;re signed in as{" "}
            <span className="text-zinc-700">{user.email}</span>
          </p>
        </div>

        <WelcomeForm />
      </div>
    </div>
  );
}
