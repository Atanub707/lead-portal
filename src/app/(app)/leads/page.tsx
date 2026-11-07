import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ArrowLeft, Mail } from "lucide-react";
import { EmailComposer } from "@/components/email-composer";
import { QuickFind } from "@/components/quick-find";
import { ScoreBadge } from "@/components/score-badge";
import { activeWorkspaceId } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGenericEmail } from "@/lib/people";

export const dynamic = "force-dynamic";

interface ImportRow {
  id: number;
  imported: number;
  skipped: number;
  status: string;
  search_url: string;
  details: { imported_ids?: number[] } | null;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const sp = await searchParams;
  const runId = Number(sp.run);
  if (!Number.isFinite(runId) || runId <= 0) {
    return (
      <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
        <header>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            Find leads
          </h1>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-500">
            One search. Companies, people, emails and LinkedIn come back ready
            to email.
          </p>
        </header>
        <div className="mt-6">
          <QuickFind />
        </div>
      </div>
    );
  }

  const workspaceId = await activeWorkspaceId();
  const admin = createAdminClient();
  const { data: runData } = await admin
    .from("lead_imports")
    .select("id, imported, skipped, status, search_url, details")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const run = runData as ImportRow | null;
  if (!run) {
    return (
      <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
        <div className="card p-6 text-center">
          <p className="text-[13px] text-zinc-600">Search not found.</p>
          <Link href="/leads" className="btn-primary mt-3 inline-flex">
            New search
          </Link>
        </div>
      </div>
    );
  }

  const ids = run.details?.imported_ids ?? [];
  if (ids.length === 0) {
    return (
      <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
        <div className="card p-6 text-center">
          <p className="text-[13px] font-medium text-zinc-800">
            This search is still finishing.
          </p>
          <p className="mt-1 text-[12px] text-zinc-500">
            {run.status === "running"
              ? "Companies are still being imported. Check back in a minute."
              : "No companies matched that search."}
          </p>
          <Link href="/leads" className="btn-primary mt-3 inline-flex">
            New search
          </Link>
        </div>
      </div>
    );
  }

  const { userId } = await auth();
  const [orgsRes, contactsRes, emailsRes, settingsRes] = await Promise.all([
    admin
      .from("organizations")
      .select("id, name, website, linkedin_url, score, grade")
      .eq("workspace_id", workspaceId)
      .in("id", ids),
    admin
      .from("contacts")
      .select("id, org_id, name, title, email, linkedin_url, is_decision_maker")
      .eq("workspace_id", workspaceId)
      .in("org_id", ids)
      .not("email", "is", null)
      .order("is_decision_maker", { ascending: false }),
    admin
      .from("company_emails")
      .select("org_id, email")
      .eq("workspace_id", workspaceId)
      .in("org_id", ids),
    userId
      ? admin
          .from("user_email_settings")
          .select("smtp_host, smtp_user")
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const bestContact = new Map<
    number,
    { id: number; name: string; title: string | null; email: string; linkedin_url: string | null }
  >();
  for (const contact of contactsRes.data ?? []) {
    const orgId = contact.org_id as number;
    if (bestContact.has(orgId)) continue;
    if (!contact.email) continue;
    bestContact.set(orgId, {
      id: contact.id as number,
      name: contact.name as string,
      title: (contact.title as string | null) ?? null,
      email: contact.email as string,
      linkedin_url: (contact.linkedin_url as string | null) ?? null,
    });
  }
  const companyEmail = new Map<number, string>();
  for (const row of emailsRes.data ?? []) {
    const orgId = row.org_id as number;
    if (!companyEmail.has(orgId)) companyEmail.set(orgId, row.email as string);
  }
  const smtpConfigured = Boolean(
    (settingsRes.data as { smtp_host?: string | null } | null)?.smtp_host
  );

  const emailsFound =
    bestContact.size +
    [...companyEmail.keys()].filter((orgId) => !bestContact.has(orgId)).length;

  return (
    <div className="w-full px-4 py-8 sm:px-8 xl:px-10">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        New search
      </Link>

      <header className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
            Your results
          </h1>
          <p className="mt-1 text-[13px] text-zinc-500">
            {run.search_url} · {ids.length} companies · {bestContact.size} contacts
            {emailsFound > 0 ? ` · ${emailsFound} emails` : ""}
          </p>
        </div>
        {!smtpConfigured ? (
          <Link
            href="/settings/email"
            className="text-[12px] text-amber-700 underline decoration-amber-300 underline-offset-2"
          >
            Set up email sending first
          </Link>
        ) : null}
      </header>

      <div className="card mt-5 overflow-hidden">
        {ids.length === 0 ? (
          <div className="p-8 text-center">
            <Mail className="mx-auto h-5 w-5 text-zinc-300" aria-hidden="true" />
            <p className="mt-2 text-[13px] text-zinc-500">No companies found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead>
                <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="py-2 pl-4 pr-3 font-medium">Company</th>
                  <th className="py-2 pr-3 font-medium">Person</th>
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">LinkedIn</th>
                  <th className="py-2 pr-3 font-medium">Match</th>
                  <th className="py-2 pr-4 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {(orgsRes.data ?? []).map((org) => {
                  const contact = bestContact.get(org.id as number);
                  const email = contact?.email ?? companyEmail.get(org.id as number) ?? null;
                  const linkedin =
                    contact?.linkedin_url ??
                    (org.linkedin_url as string | null) ??
                    null;
                  return (
                    <tr key={org.id as number} className="border-b border-zinc-100 last:border-0">
                      <td className="py-2 pl-4 pr-3">
                        <Link
                          href={`/companies/${org.id}`}
                          className="font-medium text-zinc-900 hover:underline"
                        >
                          {org.name}
                        </Link>
                        {org.website ? (
                          <span className="block text-[10px] text-zinc-400">
                            {String(org.website).replace(/^https?:\/\//, "").replace(/\/$/, "")}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-zinc-700">
                        {contact ? (
                          <>
                            {contact.name}
                            {contact.title ? (
                              <span className="block text-[10px] text-zinc-400">
                                {contact.title}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-zinc-700">
                        {email ? (
                          <span className="break-all">
                            {email}
                            {isGenericEmail(email.split("@")[0] ?? "") ? (
                              <span
                                className="ml-1.5 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-700"
                                title="Shared team inbox — may be filtered. A personal address gets better replies."
                              >
                                shared
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {linkedin ? (
                          <a
                            href={linkedin}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900"
                          >
                            Profile
                          </a>
                        ) : (
                          <span className="text-zinc-300">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <ScoreBadge
                          score={(org.score as number | null) ?? null}
                          grade={(org.grade as string | null) ?? null}
                        />
                      </td>
                      <td className="py-2 pr-4 text-right">
                        {email && smtpConfigured ? (
                          <EmailComposer
                            orgId={org.id as number}
                            contactId={contact?.id ?? null}
                            contactLabel={contact?.name ?? null}
                            defaultTo={email}
                            smtpConfigured={smtpConfigured}
                            trigger="button"
                            triggerLabel="Draft email"
                          />
                        ) : (
                          <span className="text-[11px] text-zinc-400">
                            {email ? "Set up email to send" : "No email yet"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        Website details, people and emails are filled automatically for the first
        five companies. Deep Search is manual only — open a company and click it
        if you need more contacts.
      </p>
    </div>
  );
}
