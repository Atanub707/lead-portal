// Inbound email side effects for campaigns: stop on reply, suppress on
// unsubscribe. Kept separate from both threads-db and campaigns to avoid cycles.
import type { SupabaseClient } from "@supabase/supabase-js";

const UNSUBSCRIBE_RE =
  /unsubscribe|opt[\s-]?out|remove me|stop emailing|do not contact/i;
const POSITIVE_RE =
  /interested|sounds good|happy to (chat|talk|meet)|book a (call|meeting)|let'?s (talk|chat|connect)|schedule (a )?(call|meeting)|send (me )?(a )?deck|tell me more/i;
const NEGATIVE_RE =
  /not interested|no thanks|no thank you|not a fit|already (have|use)|do not contact/i;

export async function handleInboundCampaignEffects(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string;
    userId: string;
    orgId: number | null;
    counterpartyEmail: string;
    subject: string | null;
    body: string;
  }
): Promise<void> {
  if (!opts.orgId) return;
  const text = `${opts.subject ?? ""} ${opts.body}`;
  const unsubscribe = UNSUBSCRIBE_RE.test(text);
  const positive = !unsubscribe && POSITIVE_RE.test(text);
  const negative = !unsubscribe && NEGATIVE_RE.test(text);

  const { data: enrollments } = await supabase
    .from("campaign_enrollments")
    .select("id, campaign_id")
    .eq("workspace_id", opts.workspaceId)
    .eq("org_id", opts.orgId)
    .eq("status", "active");

  for (const enrollment of enrollments ?? []) {
    await supabase
      .from("campaign_enrollments")
      .update({
        status: "stopped",
        stop_reason: unsubscribe
          ? "unsubscribed"
          : positive
            ? "positive_reply"
            : negative
              ? "not_interested"
              : "replied",
        updated_at: new Date().toISOString(),
      })
      .eq("id", enrollment.id);
    await supabase.from("campaign_events").insert({
      workspace_id: opts.workspaceId,
      campaign_id: enrollment.campaign_id,
      enrollment_id: enrollment.id,
      org_id: opts.orgId,
      kind: unsubscribe ? "unsubscribe" : positive ? "positive_reply" : "reply",
      payload: {
        email: opts.counterpartyEmail,
        subject: opts.subject,
      },
    });
  }

  if (unsubscribe) {
    await supabase.from("suppression_list").upsert(
      [
        {
          workspace_id: opts.workspaceId,
          email: opts.counterpartyEmail.toLowerCase(),
          reason: "unsubscribe",
        },
      ],
      { onConflict: "workspace_id,email", ignoreDuplicates: true }
    );
  }
}
