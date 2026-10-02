import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WelcomeForm } from "./welcome-form";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8">
      <div className="max-w-md">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">
          Welcome to the Lead Portal
        </h1>
        <p className="mt-1 text-[13px] text-zinc-500">
          You&apos;re signed in as{" "}
          <span className="text-zinc-800">{user.email}</span>. Set a password so
          you can sign in quickly next time.
        </p>

        <WelcomeForm />

        <p className="mt-3 text-center text-[12px] text-zinc-500">
          <Link
            href="/dashboard"
            className="transition-colors hover:text-zinc-900"
          >
            Skip for now →
          </Link>
        </p>
      </div>
    </div>
  );
}
