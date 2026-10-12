import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSubject, type MatchIndex } from "./threads";

export async function findOrCreateThread(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string;
    userId: string;
    orgId: number | null;
    contactId: number | null;
    counterpartyEmail: string;
    subject: string;
  }
): Promise<number> {
  const subjectNorm = normalizeSubject(opts.subject);
  const { data: existing } = await supabase
    .from("email_threads")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("counterparty_email", opts.counterpartyEmail.toLowerCase())
    .eq("subject_norm", subjectNorm)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as number;

  const { data, error } = await supabase
    .from("email_threads")
    .insert({
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      org_id: opts.orgId,
      contact_id: opts.contactId,
      subject_norm: subjectNorm,
      counterparty_email: opts.counterpartyEmail.toLowerCase(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "thread insert failed");
  return data.id as number;
}

export async function recordOutbound(
  supabase: SupabaseClient,
  opts: {
    workspaceId: string;
    userId: string;
    orgId: number | null;
    contactId: number | null;
    fromEmail: string;
    toEmail: string;
    subject: string;
    body: string;
    messageId: string;
    inReplyTo?: string | null;
    referencesIds?: string | null;
  }
): Promise<{ threadId: number }> {
  const threadId = await findOrCreateThread(supabase, {
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    orgId: opts.orgId,
    contactId: opts.contactId,
    counterpartyEmail: opts.toEmail,
    subject: opts.subject,
  });
  await supabase.from("email_messages").upsert(
    {
      thread_id: threadId,
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      direction: "out",
      from_email: opts.fromEmail,
      to_email: opts.toEmail,
      subject: opts.subject,
      body: opts.body,
      message_id: opts.messageId,
      in_reply_to: opts.inReplyTo ?? null,
      references_ids: opts.referencesIds ?? null,
    },
    { onConflict: "message_id", ignoreDuplicates: true }
  );
  await supabase
    .from("email_threads")
    .update({ last_message_at: new Date().toISOString(), unread: 0 })
    .eq("id", threadId);
  return { threadId };
}

export async function recordInbound(
  supabase: SupabaseClient,
  opts: {
    threadId: number;
    workspaceId: string;
    userId: string;
    fromEmail: string;
    toEmail: string;
    subject: string;
    body: string;
    messageId: string;
    inReplyTo: string | null;
    referencesIds: string | null;
    hasAttachments: boolean;
    sentAt: string;
  }
): Promise<void> {
  const { error } = await supabase.from("email_messages").upsert(
    {
      thread_id: opts.threadId,
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      direction: "in",
      from_email: opts.fromEmail,
      to_email: opts.toEmail,
      subject: opts.subject,
      body: opts.body,
      message_id: opts.messageId,
      in_reply_to: opts.inReplyTo,
      references_ids: opts.referencesIds,
      has_attachments: opts.hasAttachments,
      sent_at: opts.sentAt,
    },
    { onConflict: "message_id", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
  const { data: thread } = await supabase
    .from("email_threads")
    .select("unread")
    .eq("id", opts.threadId)
    .maybeSingle();
  await supabase
    .from("email_threads")
    .update({
      last_message_at: opts.sentAt,
      unread: ((thread?.unread as number | undefined) ?? 0) + 1,
    })
    .eq("id", opts.threadId);
}

export async function getMatchIndex(
  supabase: SupabaseClient,
  userId: string
): Promise<MatchIndex & { messageToThread: Map<string, number> }> {
  const messageIds = new Set<string>();
  const messageToThread = new Map<string, number>();
  const recipientEmails = new Set<string>();
  const subjects = new Map<string, string>();

  const { data: messages } = await supabase
    .from("email_messages")
    .select("message_id, thread_id, direction")
    .eq("user_id", userId);
  for (const row of messages ?? []) {
    messageIds.add(row.message_id as string);
    messageToThread.set(row.message_id as string, row.thread_id as number);
    if (row.direction === "out") {
      // Track the newest outbound message id per thread as the subject anchor.
    }
  }

  const { data: sent } = await supabase
    .from("sent_emails")
    .select("to_email, subject, message_id, created_at")
    .eq("sent_by", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  for (const row of sent ?? []) {
    recipientEmails.add((row.to_email as string).toLowerCase());
    const key = normalizeSubject(row.subject as string);
    if (!subjects.has(key) && row.message_id) {
      subjects.set(key, row.message_id as string);
    }
  }
  return { messageIds, recipientEmails, subjects, messageToThread };
}

export async function getUnreadReplyCount(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { count } = await supabase
    .from("email_threads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gt("unread", 0);
  return count ?? 0;
}
