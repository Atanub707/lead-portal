import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { decryptSecret } from "@/lib/crypto";
import { sendEmailViaSmtp } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { recordOutbound } from "@/lib/threads-db";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    threadId?: number;
    text?: string;
  };
  const threadId = Number(body.threadId);
  const text = body.text?.trim() ?? "";
  if (!threadId || !text) {
    return NextResponse.json({ ok: false, error: "Missing thread or message" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: thread } = await supabase
    .from("email_threads")
    .select("id, workspace_id, user_id, org_id, contact_id, counterparty_email, subject_norm")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
  }

  const { data: settings } = await supabase
    .from("user_email_settings")
    .select("from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings?.smtp_host || !settings.smtp_user || !settings.smtp_password_enc) {
    return NextResponse.json({ ok: false, error: "Set up email sending first." }, { status: 409 });
  }

  const { data: last } = await supabase
    .from("email_messages")
    .select("message_id, references_ids, subject")
    .eq("thread_id", threadId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const references = [last?.references_ids, last?.message_id].filter(Boolean).join(" ");
  const baseSubject = last?.subject ?? thread.subject_norm;
  const subject = /^re\s*:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

  let password: string;
  try {
    password = decryptSecret(settings.smtp_password_enc);
  } catch {
    return NextResponse.json({ ok: false, error: "Saved SMTP password can't be read — re-enter it." }, { status: 409 });
  }

  const fromEmail = settings.from_email ?? settings.smtp_user;
  try {
    const { messageId } = await sendEmailViaSmtp(
      {
        host: settings.smtp_host,
        port: Number(settings.smtp_port ?? 587),
        secure: settings.smtp_secure !== false,
        user: settings.smtp_user,
        password,
        fromName: settings.from_name,
        fromEmail,
      },
      { to: thread.counterparty_email as string, subject, body: text },
      {
        inReplyTo: last?.message_id ?? undefined,
        references: references || undefined,
        subjectOverride: subject,
      }
    );

    const admin = createAdminClient();
    if (thread.org_id == null) {
      console.error(
        "[email.reply] sent_emails insert skipped: thread has no org_id"
      );
    } else {
      const { error: recordError } = await admin.from("sent_emails").insert({
        org_id: thread.org_id as number,
        workspace_id: thread.workspace_id as string,
        contact_id: (thread.contact_id as number | null) ?? null,
        sent_by: userId,
        to_email: thread.counterparty_email as string,
        subject,
        body: text,
        message_id: messageId,
      });
      if (recordError) {
        console.error(
          "[email.reply] sent_emails insert failed:",
          recordError.message
        );
      }
    }

    await recordOutbound(admin, {
      workspaceId: thread.workspace_id as string,
      userId,
      orgId: (thread.org_id as number | null) ?? null,
      contactId: (thread.contact_id as number | null) ?? null,
      fromEmail,
      toEmail: thread.counterparty_email as string,
      subject,
      body: text,
      messageId,
      inReplyTo: last?.message_id ?? null,
      referencesIds: references || null,
    });

    await logActivity({
      actorId: userId,
      action: "email.reply",
      targetType: "email_thread",
      targetId: threadId,
      summary: `Replied to ${thread.counterparty_email}`,
    });

    return NextResponse.json({ ok: true, messageId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Send failed" },
      { status: 500 }
    );
  }
}
