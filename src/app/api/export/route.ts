import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { activeWorkspaceId } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const workspaceId = await activeWorkspaceId();
  const supabase = await createClient();
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") === "contacts" ? "contacts" : "companies";
  const list = params.get("list") ?? "";
  const q = params.get("q") ?? "";
  const kindFilter = params.get("kindFilter") ?? "";
  const minScore = Number(params.get("minScore") ?? 0);
  const starred = params.get("starred") === "1";

  if (kind === "companies") {
    let query = supabase
      .from("organizations")
      .select("id, name, website, linkedin_url, list, kind, status, priority, score, grade, notes, follow_up_on, last_signal_at, created_at")
      .eq("workspace_id", workspaceId)
      .order("score", { ascending: false, nullsFirst: false })
      .limit(5000);
    if (list) query = query.eq("list", list);
    if (q) query = query.ilike("name", `%${q}%`);
    if (kindFilter) query = query.eq("kind", kindFilter);
    if (starred) query = query.eq("bookmarked", true);
    if (Number.isFinite(minScore) && minScore > 0) query = query.gte("score", minScore);
    const { data: orgs, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (orgs ?? []).map((row) => row.id as number);
    const [firmRes, signalRes, contactRes, emailRes] = await Promise.all([
      supabase.from("company_firmographics").select("*").in("org_id", ids.length ? ids : [0]),
      supabase.from("company_signals").select("org_id, signal_key").in("org_id", ids.length ? ids : [0]),
      supabase.from("contacts").select("org_id, email").in("org_id", ids.length ? ids : [0]),
      supabase.from("company_emails").select("org_id, email").in("org_id", ids.length ? ids : [0]),
    ]);
    const firms = new Map((firmRes.data ?? []).map((row) => [row.org_id as number, row]));
    const signals = new Map<number, string[]>();
    for (const row of signalRes.data ?? []) {
      const orgId = row.org_id as number;
      signals.set(orgId, [...(signals.get(orgId) ?? []), row.signal_key as string]);
    }
    const contacts = new Map<number, { count: number; emails: number }>();
    for (const row of contactRes.data ?? []) {
      const orgId = row.org_id as number;
      const entry = contacts.get(orgId) ?? { count: 0, emails: 0 };
      entry.count += 1;
      if (row.email) entry.emails += 1;
      contacts.set(orgId, entry);
    }
    const companyEmails = new Map<number, number>();
    for (const row of emailRes.data ?? []) {
      const orgId = row.org_id as number;
      companyEmails.set(orgId, (companyEmails.get(orgId) ?? 0) + 1);
    }

    const header = [
      "id","name","website","linkedin","pipeline","type","stage","score","grade",
      "industry","employee_band","employee_count","hq_city","hq_region","hq_country",
      "funding_stage","founded_year","tech_stack","signals","contacts","contact_emails",
      "company_emails","last_signal_at","created_at",
    ];
    const rows = (orgs ?? []).map((org) => {
      const firm = firms.get(org.id as number) as Record<string, unknown> | undefined;
      const counts = contacts.get(org.id as number) ?? { count: 0, emails: 0 };
      return [
        org.id, org.name, org.website, org.linkedin_url, org.list, org.kind, org.status,
        org.score, org.grade, firm?.industry ?? "", firm?.employee_band ?? "",
        firm?.employee_count ?? "", firm?.hq_city ?? "", firm?.hq_region ?? "",
        firm?.hq_country ?? "", firm?.funding_stage ?? "", firm?.founded_year ?? "",
        (firm?.tech_stack as string[] | undefined)?.join("; ") ?? "",
        (signals.get(org.id as number) ?? []).join("; "), counts.count, counts.emails,
        companyEmails.get(org.id as number) ?? 0, org.last_signal_at, org.created_at,
      ];
    });
    const csv = toCsv([header, ...rows]);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="companies-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  let orgQuery = supabase
    .from("organizations")
    .select("id, name, list")
    .eq("workspace_id", workspaceId)
    .limit(5000);
  if (list) orgQuery = orgQuery.eq("list", list);
  if (q) orgQuery = orgQuery.ilike("name", `%${q}%`);
  const { data: orgs } = await orgQuery;
  const orgMap = new Map((orgs ?? []).map((row) => [row.id as number, row]));
  const orgIds = [...orgMap.keys()];

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("id, org_id, name, title, email, email_status, seniority, is_decision_maker, linkedin_url, phone, source, created_at")
    .eq("workspace_id", workspaceId)
    .in("org_id", orgIds.length ? orgIds : [0])
    .order("is_decision_maker", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const header = [
    "id","name","title","email","email_status","seniority","decision_maker",
    "linkedin","phone","company","company_id","pipeline","source","created_at",
  ];
  const rows = (contacts ?? []).map((contact) => {
    const org = orgMap.get(contact.org_id as number);
    return [
      contact.id, contact.name, contact.title, contact.email, contact.email_status,
      contact.seniority, contact.is_decision_maker ? "yes" : "no", contact.linkedin_url,
      contact.phone, org?.name ?? "", contact.org_id, org?.list ?? "",
      contact.source, contact.created_at,
    ];
  });
  const csv = toCsv([header, ...rows]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
