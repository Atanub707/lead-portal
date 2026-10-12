import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { defaultImapHost, scanInbox } from "@/lib/imap";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMatchIndex, recordInbound } from "@/lib/threads-db";

const THROTTLE_MS = 2 * 60 * 1000;

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const admin = createAdminClient();
  const { data: settings } = await admin
    .from("user_email_settings")
    .select("smtp_host, smtp_user, smtp_password_enc, imap_host, imap_last_uid, imap_uidvalidity, imap_last_sync_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings?.smtp_user || !settings.smtp_password_enc) {
    return NextResponse.json({ ok: false, error: "Set up email sending first." }, { status: 409 });
  }
  if (settings.imap_last_sync_at && Date.now() - new Date(settings.imap_last_sync_at).getTime() < THROTTLE_MS) {
    return NextResponse.json({ ok: true, skipped: true, lastSyncAt: settings.imap_last_sync_at });
  }

  let password: string;
  try {
    password = decryptSecret(settings.smtp_password_enc);
  } catch {
    return NextResponse.json({ ok: false, error: "Saved password can't be read — re-enter it." }, { status: 409 });
  }

  const index = await getMatchIndex(admin, userId);
  const host = settings.imap_host ?? defaultImapHost(settings.smtp_host ?? "", settings.smtp_user);

  try {
    const result = await scanInbox({
      host,
      user: settings.smtp_user,
      password,
      lastUid: settings.imap_last_uid ?? null,
      lastUidValidity: settings.imap_uidvalidity ?? null,
      index,
      onMatch: async (payload) => {
        const threadId = index.messageToThread.get(payload.anchorMessageId);
        if (!threadId) return;
        const { data: thread } = await admin
          .from("email_threads")
          .select("workspace_id, user_id, counterparty_email")
          .eq("id", threadId)
          .eq("user_id", userId)
          .maybeSingle();
        if (!thread) return;
        await recordInbound(admin, {
          threadId,
          workspaceId: thread.workspace_id as string,
          userId,
          fromEmail: payload.fromEmail,
          toEmail: settings.smtp_user as string,
          subject: payload.subject,
          body: payload.body,
          messageId: payload.messageId,
          inReplyTo: payload.inReplyTo,
          referencesIds: payload.referencesIds,
          hasAttachments: payload.hasAttachments,
          sentAt: payload.sentAt,
        });
      },
    });

    await admin
      .from("user_email_settings")
      .update({
        imap_host: host,
        imap_last_uid: result.lastUid,
        imap_uidvalidity: result.uidValidity,
        imap_last_sync_at: new Date().toISOString(),
        imap_last_error: null,
      })
      .eq("user_id", userId);

    return NextResponse.json({
      ok: true,
      scanned: result.scanned,
      matched: result.matched,
      lastSyncAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    console.error("[email.sync] failed:", message);
    await admin
      .from("user_email_settings")
      .update({ imap_last_error: message.slice(0, 300), imap_last_sync_at: new Date().toISOString() })
      .eq("user_id", userId);
    return NextResponse.json({ ok: false, error: friendlyImapError(message) }, { status: 502 });
  }
}

function friendlyImapError(message: string): string {
  if (/auth|invalid credentials|login/i.test(message)) {
    return "Couldn't sign in to your mailbox for reading replies — check the app password (Gmail needs 2-Step Verification + App Password).";
  }
  if (/IMAP|disabled|not enabled/i.test(message)) {
    return "IMAP is disabled on this mailbox — enable IMAP in your mail settings.";
  }
  return "Couldn't read your mailbox right now. It will retry on the next sync.";
}
