import { redirect } from "next/navigation";
import { ensureProfile } from "@/lib/auth";
import { OnboardingForm } from "./onboarding-form";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const profile = await ensureProfile();
  if (!profile) {
    redirect("/sign-in");
  }
  if (profile.workspace_id) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
          Create your workspace
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
          Name your workspace — you can rename it later. You&apos;ll get a
          14-day trial and can invite your team right away.
        </p>
        <OnboardingForm />
      </div>
    </div>
  );
}
