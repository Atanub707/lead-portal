import { activeWorkspaceId } from "./data";
import { createClient } from "./supabase/server";

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  pipeline_id: string | null;
  min_score: number;
  daily_cap: number;
  steps: number;
  enrolled: number;
  active: number;
  sent: number;
  replies: number;
  created_at: string;
}

export async function getCampaigns(): Promise<CampaignSummary[]> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, name, status, pipeline_id, min_score, daily_cap, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (!campaigns || campaigns.length === 0) return [];

  const ids = campaigns.map((row) => row.id as string);
  const [steps, enrollments, events] = await Promise.all([
    supabase.from("campaign_steps").select("campaign_id").in("campaign_id", ids),
    supabase
      .from("campaign_enrollments")
      .select("campaign_id, status")
      .in("campaign_id", ids),
    supabase
      .from("campaign_events")
      .select("campaign_id, kind")
      .in("campaign_id", ids),
  ]);

  const stepCount = new Map<string, number>();
  for (const row of steps.data ?? []) {
    const id = row.campaign_id as string;
    stepCount.set(id, (stepCount.get(id) ?? 0) + 1);
  }
  const enrolledCount = new Map<string, number>();
  const activeCount = new Map<string, number>();
  for (const row of enrollments.data ?? []) {
    const id = row.campaign_id as string;
    enrolledCount.set(id, (enrolledCount.get(id) ?? 0) + 1);
    if (row.status === "active") activeCount.set(id, (activeCount.get(id) ?? 0) + 1);
  }
  const sentCount = new Map<string, number>();
  const replyCount = new Map<string, number>();
  for (const row of events.data ?? []) {
    const id = row.campaign_id as string;
    if (row.kind === "sent") sentCount.set(id, (sentCount.get(id) ?? 0) + 1);
    if (row.kind === "reply") replyCount.set(id, (replyCount.get(id) ?? 0) + 1);
  }

  return campaigns.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    status: row.status as string,
    pipeline_id: row.pipeline_id as string | null,
    min_score: Number(row.min_score ?? 0),
    daily_cap: Number(row.daily_cap ?? 30),
    steps: stepCount.get(row.id as string) ?? 0,
    enrolled: enrolledCount.get(row.id as string) ?? 0,
    active: activeCount.get(row.id as string) ?? 0,
    sent: sentCount.get(row.id as string) ?? 0,
    replies: replyCount.get(row.id as string) ?? 0,
    created_at: row.created_at as string,
  }));
}

export interface CampaignDetail {
  campaign: {
    id: string;
    name: string;
    status: string;
    pipeline_id: string | null;
    min_score: number;
    daily_cap: number;
    stop_on_reply: boolean;
    send_window: unknown;
    created_at: string;
  } | null;
  steps: { id: string; step_no: number; delay_days: number; flavor: string | null; channel: string }[];
  enrollments: {
    id: number;
    org_id: number;
    org_name: string;
    contact_name: string | null;
    to_email: string | null;
    status: string;
    current_step: number;
    next_run_at: string | null;
    stop_reason: string | null;
  }[];
  events: {
    id: number;
    kind: string;
    org_name: string | null;
    payload: unknown;
    created_at: string;
  }[];
}

export async function getCampaignDetail(id: string): Promise<CampaignDetail> {
  const supabase = await createClient();
  const workspaceId = await activeWorkspaceId();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (!campaign) {
    return { campaign: null, steps: [], enrollments: [], events: [] };
  }

  const [stepsRes, enrollmentsRes, eventsRes] = await Promise.all([
    supabase
      .from("campaign_steps")
      .select("id, step_no, delay_days, flavor, channel")
      .eq("campaign_id", id)
      .order("step_no"),
    supabase
      .from("campaign_enrollments")
      .select("id, org_id, contact_id, status, current_step, next_run_at, stop_reason")
      .eq("campaign_id", id)
      .order("id", { ascending: false })
      .limit(100),
    supabase
      .from("campaign_events")
      .select("id, kind, org_id, payload, created_at")
      .eq("campaign_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const orgIds = [
    ...new Set([
      ...(enrollmentsRes.data ?? []).map((row) => row.org_id as number),
      ...(eventsRes.data ?? [])
        .map((row) => row.org_id as number | null)
        .filter((value): value is number => Boolean(value)),
    ]),
  ];
  const contactIds = [
    ...new Set(
      (enrollmentsRes.data ?? [])
        .map((row) => row.contact_id as number | null)
        .filter((value): value is number => Boolean(value))
    ),
  ];
  const [orgsRes, contactsRes] = await Promise.all([
    orgIds.length > 0
      ? supabase.from("organizations").select("id, name").in("id", orgIds)
      : Promise.resolve({ data: [] as { id: number; name: string }[] }),
    contactIds.length > 0
      ? supabase.from("contacts").select("id, name, email").in("id", contactIds)
      : Promise.resolve({ data: [] as { id: number; name: string; email: string | null }[] }),
  ]);
  const orgNames = new Map((orgsRes.data ?? []).map((row) => [row.id as number, row.name as string]));
  const contacts = new Map(
    (contactsRes.data ?? []).map((row) => [
      row.id as number,
      { name: row.name as string, email: row.email as string | null },
    ])
  );

  return {
    campaign: {
      id: campaign.id as string,
      name: campaign.name as string,
      status: campaign.status as string,
      pipeline_id: campaign.pipeline_id as string | null,
      min_score: Number(campaign.min_score ?? 0),
      daily_cap: Number(campaign.daily_cap ?? 30),
      stop_on_reply: Boolean(campaign.stop_on_reply),
      send_window: campaign.send_window,
      created_at: campaign.created_at as string,
    },
    steps: (stepsRes.data ?? []).map((row) => ({
      id: row.id as string,
      step_no: Number(row.step_no),
      delay_days: Number(row.delay_days),
      flavor: row.flavor as string | null,
      channel: row.channel as string,
    })),
    enrollments: (enrollmentsRes.data ?? []).map((row) => {
      const contact = contacts.get(row.contact_id as number);
      return {
        id: Number(row.id),
        org_id: Number(row.org_id),
        org_name: orgNames.get(row.org_id as number) ?? `#${row.org_id}`,
        contact_name: contact?.name ?? null,
        to_email: contact?.email ?? null,
        status: row.status as string,
        current_step: Number(row.current_step),
        next_run_at: row.next_run_at as string | null,
        stop_reason: row.stop_reason as string | null,
      };
    }),
    events: (eventsRes.data ?? []).map((row) => ({
      id: Number(row.id),
      kind: row.kind as string,
      org_name: orgNames.get(row.org_id as number) ?? null,
      payload: row.payload,
      created_at: row.created_at as string,
    })),
  };
}
