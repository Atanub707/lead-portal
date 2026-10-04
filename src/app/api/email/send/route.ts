import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity";
import { decryptSecret } from "@/lib/crypto";
import { sendEmailViaSmtp } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: {
    orgId?: number;
    contactId?: number | null;
    to?: string;
    subject?: string;
    body?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400 });
  }

  const orgId = Number(body.orgId);
  const to = body.to?.trim() ?? "";
  const subject = body.subject?.trim() ?? "";
  const text = body.body?.trim() ?? "";
  if (!orgId || !to || !subject || !text) {
    return NextResponse.json(
      { ok: false, error: "Missing recipient, subject, or body" },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("user_email_settings")
    .select(
      "from_name, from_email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_password_enc"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (!settings?.smtp_host || !settings.smtp_user || !settings.smtp_password_enc) {
    return NextResponse.json(
      { ok: false, error: "Set up email sending first." },
      { status: 409 }
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

  let password: string;
  try {
    password = decryptSecret(settings.smtp_password_enc);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Saved SMTP password can't be read — please re-enter it." },
      { status: 409 }
    );
  }

  try {
    await sendEmailViaSmtp(
      {
        host: settings.smtp_host,
        port: Number(settings.smtp_port ?? 587),
        secure: settings.smtp_secure !== false,
        user: settings.smtp_user,
        password,
        fromName: settings.from_name,
        fromEmail: settings.from_email,
      },
      { to, subject, body: text }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const admin = createAdminClient();
  const { error: recordError } = await admin.from("sent_emails").insert({
    org_id: orgId,
    contact_id: body.contactId ?? null,
    sent_by: userId,
    to_email: to,
    subject,
    body: text,
  });
  if (recordError) {
    console.error("[email.send] sent_emails insert failed:", recordError.message);
  }

  await logActivity({
    actorId: userId,
    action: "email.sent",
    orgId,
    targetType: "company",
    targetId: orgId,
    summary: `Sent “${subject}” to ${org?.name ?? "company"} (${to})`,
  });

  const { error: interactionError } = await supabase.from("interactions").insert({
    org_id: orgId,
    contact_id: body.contactId ?? null,
    channel: "email",
    summary: `Email sent: ${subject}`,
    logged_by: userId,
  });
  if (interactionError) {
    console.error("[email.send] interaction insert failed:", interactionError.message);
  }

  return NextResponse.json({ ok: true });
}
