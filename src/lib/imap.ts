import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";
import { matchInbound, type MatchIndex } from "./threads";

export const IMAP_PRESETS: { match: RegExp; host: string }[] = [
  { match: /gmail|googlemail/i, host: "imap.gmail.com" },
  { match: /outlook|office365|hotmail|live\.com/i, host: "outlook.office365.com" },
  { match: /zoho/i, host: "imap.zoho.com" },
];

export function defaultImapHost(smtpHost: string, smtpUser: string): string {
  const combined = `${smtpHost} ${smtpUser}`;
  for (const preset of IMAP_PRESETS) {
    if (preset.match.test(combined)) return preset.host;
  }
  return smtpHost; // sensible default: same host
}

export interface SyncResult {
  scanned: number;
  matched: number;
  lastUid: number;
  uidValidity: number;
  uidValidityChanged: boolean;
}

const MAX_PER_SYNC = 200;

export async function scanInbox(opts: {
  host: string;
  user: string;
  password: string;
  lastUid: number | null;
  lastUidValidity: number | null;
  index: MatchIndex;
  onMatch: (payload: {
    anchorMessageId: string;
    messageId: string;
    fromEmail: string;
    subject: string;
    body: string;
    inReplyTo: string | null;
    referencesIds: string | null;
    hasAttachments: boolean;
    sentAt: string;
  }) => Promise<void>;
}): Promise<SyncResult> {
  const client = new ImapFlow({
    host: opts.host,
    port: 993,
    secure: true,
    auth: { user: opts.user, pass: opts.password },
    logger: false,
  });

  let scanned = 0;
  let matched = 0;
  let lastUid = opts.lastUid ?? 0;
  let uidValidity = opts.lastUidValidity ?? 0;
  let uidValidityChanged = false;

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === "boolean") throw new Error("INBOX unavailable");
      const currentUidValidity = Number(mailbox.uidValidity ?? 0);
      if (opts.lastUidValidity !== null && currentUidValidity !== opts.lastUidValidity) {
        uidValidityChanged = true;
        lastUid = Math.max(0, Number(mailbox.uidNext) - MAX_PER_SYNC);
      }
      uidValidity = currentUidValidity;

      // First sync starts at the most recent MAX_PER_SYNC messages (≈ the last 30 days of a normal inbox), not the mailbox's oldest mail.
      const startUid = opts.lastUid === null ? Math.max(1, Number(mailbox.uidNext) - MAX_PER_SYNC) : lastUid + 1;
      const uids: number[] = [];
      for await (const msg of client.fetch(
        `${startUid}:*`,
        { uid: true, envelope: true, headers: ["in-reply-to", "references", "message-id", "subject", "from", "date"] },
        { uid: true }
      )) {
        if (msg.uid <= lastUid) continue;
        uids.push(msg.uid);
        if (uids.length >= MAX_PER_SYNC) break;
      }

      for (const uid of uids) {
        scanned += 1;
        lastUid = Math.max(lastUid, uid);
        const headerMsg = await client.fetchOne(String(uid), { headers: ["in-reply-to", "references", "message-id", "subject", "from", "date"] }, { uid: true });
        if (!headerMsg) continue;
        const headers = headerMsg.headers;
        const rawHeaders = headers ? headers.toString("utf8") : "";
        const unfoldedHeaders = rawHeaders.replace(/\r?\n[ \t]+/g, " ");
        const get = (name: string): string | null => {
          const m = unfoldedHeaders.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
          return m ? m[1].trim() : null;
        };
        const messageId = (get("message-id") ?? "").replace(/[<>]/g, "");
        if (!messageId) continue;
        const references = (get("references") ?? "")
          .split(/\s+/)
          .map((id) => id.replace(/[<>]/g, ""))
          .filter(Boolean);
        const fromEmail = (get("from") ?? "").match(/<([^>]+)>/)?.[1] ?? (get("from") ?? "").trim();
        const subject = get("subject") ?? "";
        const inReplyTo = get("in-reply-to")?.replace(/[<>]/g, "") ?? null;

        const match = matchInbound(
          { messageId, inReplyTo, references, fromEmail, subject },
          opts.index
        );
        if (!match) continue;

        const full = await client.download(String(uid), undefined, { uid: true });
        if (!full?.content) continue;
        const chunks: Buffer[] = [];
        for await (const chunk of full.content) chunks.push(Buffer.from(chunk));
        const parsed = await PostalMime.parse(Buffer.concat(chunks));
        const bodyText =
          (parsed.text && parsed.text.trim()) ||
          (parsed.html ? parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "") ||
          "(no text content)";
        const parsedDate = new Date(parsed.date ?? "");
        const sentAt = Number.isNaN(parsedDate.getTime())
          ? new Date().toISOString()
          : parsedDate.toISOString();
        await opts.onMatch({
          anchorMessageId: match.anchorMessageId,
          messageId,
          fromEmail,
          subject,
          body: bodyText.slice(0, 20000),
          inReplyTo,
          referencesIds: references.join(" ") || null,
          hasAttachments: (parsed.attachments?.length ?? 0) > 0,
          sentAt,
        });
        matched += 1;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return { scanned, matched, lastUid, uidValidity, uidValidityChanged };
}
