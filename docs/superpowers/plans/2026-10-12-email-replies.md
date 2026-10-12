# Email Replies (In-App Conversations) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal-native replies: emails sent from the portal + their replies, personal per-member, Gmail-like UX, IMAP-synced with reply-only capture.

**Architecture:** Outbound sends store their `Message-ID` and create thread/message rows. A sync route uses `imapflow` to read INBOX headers only, keeps messages that match a stored `Message-ID` (or the safe fallback), and stores matches. A personal RLS layer keeps threads private per member.

**Tech Stack:** Next.js 16 App Router, Supabase (RLS), Clerk, `imapflow` + `postal-mime` (both MIT, new deps), existing AES-256-GCM vault.

## Global Constraints

- Capture = **replies only** (message-id match, else fallback: sender emailed + "Re:" subject). Non-matches are never stored.
- Visibility = **personal**: RLS `user_id = public.clerk_user_id()` on both new tables.
- Mailbox = **read-only** (INBOX only; never move/delete/flag).
- Freshness = sync on open (server throttle **≥ 2 min**), Sync-now button; not push.
- Caps: **200 messages per sync**, first-sync window **30 days**, work budget ≤ 90 s.
- Credentials: decrypt in memory only; never log; errors must not include secrets.
- New deps allowed: `imapflow`, `postal-mime` (only).
- Every task ends with `npm run lint && npm run build` passing and a commit; push deploys production.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20261012100000_email_replies.sql` | Columns, `email_threads`, `email_messages`, RLS |
| `src/lib/threads.ts` | Pure threading logic (normalize, match, key) — import-free, unit-testable |
| `src/lib/threads-db.ts` | DB ops: findOrCreateThread, recordOutbound, recordInbound, counts |
| `src/lib/imap.ts` | imapflow sync: connect, header scan, match callback, body fetch |
| `src/app/api/email/sync/route.ts` | Throttled sync endpoint (personal) |
| `src/app/api/email/reply/route.ts` | Reply-from-portal send + store |
| `src/lib/email.ts` | `sendEmailViaSmtp` returns `{ messageId }`; optional threading headers |
| `src/app/api/email/send/route.ts` | Store `message_id` + record outbound thread/message |
| `src/lib/types.ts` | `EmailThread`, `EmailMessage` types |
| `src/lib/data.ts` | `getReplyThreads`, `getReplyThread`, `getUnreadReplyCount` |
| `src/components/sidebar-nav.tsx`, `shell.tsx` | "Replies" nav item + unread badge |
| `src/app/(app)/replies/page.tsx`, `replies/[id]/page.tsx` | List + conversation |
| `src/components/reply-thread.tsx` | Client: reply box, Sync now, auto-sync on open |
| `src/app/(app)/companies/[id]/page.tsx` | "Emails" section (my threads for the org) |
| `src/app/(app)/settings/email/page.tsx` | Reply-sync card (status, host, last sync, Sync now) |

---

### Task 1: Migration + pure threading logic

**Files:**
- Create: `supabase/migrations/20261012100000_email_replies.sql`
- Create: `src/lib/threads.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: SQL tables; `normalizeSubject(s: string): string`; `threadKey(counterpartyEmail: string, subject: string): string`; `matchInbound(msg: InboundHeaders, index: MatchIndex): { messageId: string; threadMessageId: string } | null` where `MatchIndex = { messageIds: Set<string>; recipientEmails: Set<string>; subjects: Map<string, string /* thread's root message id */> }` and `InboundHeaders = { messageId: string; inReplyTo: string | null; references: string[]; fromEmail: string; subject: string }`.

- [ ] **Step 1: Write the migration**

```sql
-- Email replies: in-app conversations (personal per member, reply-only capture).
alter table public.sent_emails add column if not exists message_id text;
alter table public.sent_emails add column if not exists in_reply_to text;
alter table public.sent_emails add column if not exists references_ids text;

alter table public.user_email_settings
  add column if not exists imap_host text,
  add column if not exists imap_last_uid bigint,
  add column if not exists imap_uidvalidity bigint,
  add column if not exists imap_last_sync_at timestamptz,
  add column if not exists imap_last_error text;

create table if not exists public.email_threads (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id text not null,
  org_id bigint references public.organizations (id) on delete set null,
  contact_id bigint references public.contacts (id) on delete set null,
  subject_norm text not null,
  counterparty_email text not null,
  last_message_at timestamptz not null default now(),
  unread integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists email_threads_user_idx on public.email_threads (user_id, last_message_at desc);

create table if not exists public.email_messages (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.email_threads (id) on delete cascade,
  workspace_id uuid not null,
  user_id text not null,
  direction text not null check (direction in ('out', 'in')),
  from_email text not null,
  to_email text not null,
  subject text,
  body text not null,
  message_id text not null unique,
  in_reply_to text,
  references_ids text,
  has_attachments boolean not null default false,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists email_messages_thread_idx on public.email_messages (thread_id, sent_at);

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

create policy "email_threads_personal" on public.email_threads
  for select to authenticated using (
    user_id = public.clerk_user_id() and workspace_id = public.my_workspace()
  );
create policy "email_messages_personal" on public.email_messages
  for select to authenticated using (
    user_id = public.clerk_user_id() and workspace_id = public.my_workspace()
  );

grant select on public.email_threads, public.email_messages to authenticated;
grant all privileges on public.email_threads, public.email_messages to service_role;
```

- [ ] **Step 2: Apply the migration via the Management API** (same pattern as `20261005140000`; record version `20261012100000`, name `email_replies`). Expected `201`.

- [ ] **Step 3: Write `src/lib/threads.ts` (pure, import-free)**

```ts
// Pure threading helpers — no imports so the logic is trivially testable and
// safe to use from routes, jobs, and scripts.

export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  // Strip any number of Re:/Fwd:/RE:/FW: prefixes (and localized variants we see).
  const prefix = /^(re|fwd|fw|res|aw|sv|vs)\s*(\[\d+\])?\s*:\s*/i;
  while (prefix.test(s)) s = s.replace(prefix, "").trim();
  return s.replace(/\s+/g, " ").toLowerCase();
}

export function threadKey(counterpartyEmail: string, subject: string): string {
  return `${counterpartyEmail.trim().toLowerCase()}|${normalizeSubject(subject)}`;
}

export interface InboundHeaders {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  fromEmail: string;
  subject: string;
}

export interface MatchIndex {
  // All message ids this user sent (root + replies we stored).
  messageIds: Set<string>;
  // Emails this user has emailed from the portal.
  recipientEmails: Set<string>;
  // normalizeSubject(subject) -> thread root message id (latest wins).
  subjects: Map<string, string>;
}

export interface InboundMatch {
  // The stored message id this inbound message replies to (thread anchor).
  anchorMessageId: string;
}

export function matchInbound(
  msg: InboundHeaders,
  index: MatchIndex
): InboundMatch | null {
  // Primary: exact threading headers.
  const candidates = [msg.inReplyTo, ...msg.references].filter(
    (id): id is string => Boolean(id)
  );
  for (const id of candidates) {
    if (index.messageIds.has(id)) return { anchorMessageId: id };
  }
  // Fallback: from someone we emailed AND subject matches a subject we sent.
  const from = msg.fromEmail.trim().toLowerCase();
  if (index.recipientEmails.has(from)) {
    const anchor = index.subjects.get(normalizeSubject(msg.subject));
    if (anchor) return { anchorMessageId: anchor };
  }
  return null;
}
```

- [ ] **Step 4: Unit-test the pure logic with Node type-stripping**

Run:
```bash
node --input-type=module -e "
const m = await import('./src/lib/threads.ts');
const idx = {
  messageIds: new Set(['m1@x']),
  recipientEmails: new Set(['lead@acme.com']),
  subjects: new Map([['hello acme', 'm1@x']]),
};
const ok1 = m.matchInbound({ messageId:'r1@y', inReplyTo:'m1@x', references:[], fromEmail:'lead@acme.com', subject:'Re: Hello Acme' }, idx)?.anchorMessageId === 'm1@x';
const ok2 = m.matchInbound({ messageId:'r2@y', inReplyTo:null, references:[], fromEmail:'lead@acme.com', subject:'RE: re: Hello Acme' }, idx)?.anchorMessageId === 'm1@x';
const ok3 = m.matchInbound({ messageId:'r3@y', inReplyTo:null, references:[], fromEmail:'stranger@x.com', subject:'Re: Hello Acme' }, idx) === null;
const ok4 = m.normalizeSubject('Fwd: RE: Hello Acme') === 'hello acme';
console.log('threads tests:', ok1, ok2, ok3, ok4);
if (!(ok1 && ok2 && ok3 && ok4)) process.exit(1);
"
```
Expected: `threads tests: true true true true`.

- [ ] **Step 5: Types**

```ts
export interface EmailThread {
  id: number;
  workspace_id: string;
  user_id: string;
  org_id: number | null;
  contact_id: number | null;
  subject_norm: string;
  counterparty_email: string;
  last_message_at: string;
  unread: number;
  created_at: string;
}

export interface EmailMessage {
  id: number;
  thread_id: number;
  direction: "out" | "in";
  from_email: string;
  to_email: string;
  subject: string | null;
  body: string;
  message_id: string;
  sent_at: string;
  has_attachments: boolean;
}
```

- [ ] **Step 6: Lint + build + commit**

```bash
npm run lint && npm run build
git add supabase/migrations/20261012100000_email_replies.sql src/lib/threads.ts src/lib/types.ts
git commit -m "feat(replies): schema + pure threading logic (reply-only matching)"
```

---

### Task 2: DB helpers + outbound wiring (send stores message-id + thread)

**Files:**
- Create: `src/lib/threads-db.ts`
- Modify: `src/lib/email.ts` (return `{ messageId }`, optional headers)
- Modify: `src/app/api/email/send/route.ts`
- Create: `src/app/api/email/reply/route.ts`

**Interfaces:**
- Consumes: `threadKey`, `normalizeSubject` from Task 1.
- Produces: `recordOutbound(supabase, { workspaceId, userId, orgId, contactId, toEmail, subject, body, messageId, inReplyTo?, referencesIds? }) → { threadId }`; `recordInbound(...) → { threadId }`; `getMatchIndex(supabase, userId) → MatchIndex`; `sendEmailViaSmtp` now returns `Promise<{ messageId: string }>` and accepts `opts?: { inReplyTo?: string; references?: string; subjectOverride?: string }`.

- [ ] **Step 1: `src/lib/threads-db.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSubject, threadKey, type MatchIndex } from "./threads";

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
```

Note: `threadKey` from Task 1 is not needed by these helpers (kept for future use/tests). If lint flags the unused import, remove it from this file.

- [ ] **Step 2: `sendEmailViaSmtp` returns the message id + accepts threading headers**

In `src/lib/email.ts` change the signature and body:

```ts
export async function sendEmailViaSmtp(
  settings: SmtpSendSettings,
  message: { to: string; subject: string; body: string },
  opts?: { inReplyTo?: string; references?: string; subjectOverride?: string }
): Promise<{ messageId: string }> {
  // ...transport as today...
  try {
    const info = await transport.sendMail({
      from,
      to: message.to,
      subject: opts?.subjectOverride ?? message.subject,
      text: message.body,
      replyTo: fromAddress,
      ...(opts?.inReplyTo ? { inReplyTo: opts.inReplyTo } : {}),
      ...(opts?.references ? { references: opts.references } : {}),
    });
    return { messageId: info.messageId ?? `${Date.now()}@leadportal` };
  } catch (err) {
    // ...existing friendly error mapping unchanged...
  } finally {
    transport.close();
  }
}
```

- [ ] **Step 3: `/api/email/send` stores the message id + records the outbound thread**

After the successful send and before the `sent_emails` insert, capture the result; add `message_id` to the insert; call `recordOutbound` with the service/admin client (workspace id already resolved as `workspaceId` in the route):

```ts
    const { messageId } = await sendEmailViaSmtp(/* existing args */);

    const { error: recordError } = await admin.from("sent_emails").insert({
      org_id: orgId,
      workspace_id: workspaceId,
      contact_id: body.contactId ?? null,
      sent_by: userId,
      to_email: to,
      subject,
      body: text,
      message_id: messageId,
    });
    // ...existing error log...

    try {
      await recordOutbound(admin, {
        workspaceId,
        userId,
        orgId,
        contactId: body.contactId ?? null,
        fromEmail: settings.from_email ?? settings.smtp_user,
        toEmail: to,
        subject,
        body: text,
        messageId,
      });
    } catch (err) {
      console.error("[email.send] thread record failed:", err);
    }
```

- [ ] **Step 4: `/api/email/reply` route**

```ts
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
  const subject = `Re: ${last?.subject ?? thread.subject_norm}`;

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
```

- [ ] **Step 5: E2E — outbound creates thread + message**

Disposable workspace + test user (as in previous tasks). Insert user_email_settings WITHOUT real SMTP? The send needs SMTP… For the DB-side verification we can call `recordOutbound` indirectly only via a real send. Instead verify the pieces that don't need SMTP:
1. After a real send attempt (SMTP will fail for a fake host) the thread must NOT be created — assert no thread.
2. Directly call the API for `/api/email/reply` with no settings → 409 ✓.
3. Insert a thread + message via service key; then load `/replies` (Task 5) later.
Keep Task 2's live verification minimal: `npm run lint && npm run build` + assert `/api/email/reply` returns 409 without settings (deployed check after Task 5's deploy). Note in the report.

- [ ] **Step 6: Lint + build + commit**

```bash
npm run lint && npm run build
git add src/lib/threads-db.ts src/lib/email.ts src/app/api/email/send/route.ts src/app/api/email/reply/route.ts
git commit -m "feat(replies): outbound threading — message-id capture, thread records, reply-from-portal route"
```

---

### Task 3: Sync route (IMAP) + live E2E with synthetic reply

**Files:**
- Create: `src/lib/imap.ts`
- Create: `src/app/api/email/sync/route.ts`
- Modify: `package.json` (deps: `imapflow`, `postal-mime`)

**Interfaces:**
- Consumes: `matchInbound` (Task 1), `getMatchIndex`/`recordInbound` (Task 2).
- Produces: `POST /api/email/sync → { ok, skipped?, scanned, matched, lastSyncAt, error? }`.

- [ ] **Step 1: Install deps**

```bash
npm i imapflow postal-mime
```

- [ ] **Step 2: `src/lib/imap.ts`**

```ts
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
      if (mailbox.uidValidity !== undefined && opts.lastUidValidity !== null && mailbox.uidValidity !== opts.lastUidValidity) {
        uidValidityChanged = true;
        lastUid = Math.max(0, Number(mailbox.uidNext) - MAX_PER_SYNC);
      }
      uidValidity = Number(mailbox.uidValidity ?? 0);

      const startUid = lastUid + 1;
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
        const headers = headerMsg.headers;
        const rawHeaders = headers ? headers.toString("utf8") : "";
        const get = (name: string): string | null => {
          const m = rawHeaders.match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
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
        const sentAt = parsed.date ? new Date(parsed.date).toISOString() : new Date().toISOString();
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
```

- [ ] **Step 3: `/api/email/sync` route**

```ts
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { defaultImapHost, scanInbox } from "@/lib/imap";
import { createClient } from "@/lib/supabase/server";
import { getMatchIndex, recordInbound } from "@/lib/threads-db";

const THROTTLE_MS = 2 * 60 * 1000;

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const supabase = await createClient();
  const { data: settings } = await supabase
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

  const index = await getMatchIndex(supabase, userId);
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
        const { data: thread } = await supabase
          .from("email_threads")
          .select("workspace_id, user_id, counterparty_email")
          .eq("id", threadId)
          .maybeSingle();
        if (!thread) return;
        await recordInbound(supabase, {
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

    await supabase
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
    await supabase
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
```

Note: writes use the user client; RLS on the new tables only grants SELECT to authenticated. Adjust: `recordInbound` and the `user_email_settings` update need the **admin client** (service role) — switch the route to `createAdminClient()` for all writes (reads for settings/threads can stay user-scoped; simplest: use admin for everything after auth, hard-scoping queries by `userId`). Update Task 2's `recordInbound`/`recordOutbound` calls accordingly (they already receive whichever client the caller passes; pass `admin`).

- [ ] **Step 4: Live E2E — real mailbox, synthetic reply, cleanup**

Script (harness):
1. Pick a disposable test user; copy the owner's `user_email_settings` row to it via service key (same encrypted password) — this gives the test user the real Gmail credentials without touching the owner's data.
2. Create a thread + outbound message via service key (unique `message_id` `e2e-<ts>@test`) so the match index has an anchor.
3. APPEND a synthetic reply (raw RFC822 with `In-Reply-To: <e2e-<ts>@test>`) to INBOX via imapflow using the same credentials.
4. Call `POST /api/email/sync` as the test user → expect `matched: 1`; assert the inbound `email_messages` row exists in the thread and `unread` incremented.
5. Assert an unrelated message (no matching headers) is NOT stored (insert a decoy into INBOX, sync, assert no row, then remove both synthetic messages from INBOX via imapflow).
6. Delete test artifacts (test user, copied settings row, thread/messages).
Report the raw counts. Note: two synthetic messages briefly exist in the real INBOX and are deleted in cleanup — record this in the report.

- [ ] **Step 5: Lint + build + commit + deploy**

```bash
npm run lint && npm run build
git add package.json package-lock.json src/lib/imap.ts src/app/api/email/sync/route.ts
git commit -m "feat(replies): IMAP sync route — reply-only capture with UID tracking"
git push
```

---

### Task 4: UI — Replies section, thread view, sidebar badge, company section, settings card

**Files:**
- Modify: `src/lib/data.ts` (`getReplyThreads`, `getReplyThread`, `getUnreadReplyCount` already in threads-db — re-export or call directly)
- Create: `src/app/(app)/replies/page.tsx`, `src/app/(app)/replies/[id]/page.tsx`
- Create: `src/components/reply-thread.tsx`
- Modify: `src/components/sidebar-nav.tsx`, `src/components/shell.tsx`, `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/companies/[id]/page.tsx`
- Modify: `src/app/(app)/settings/email/page.tsx`

**Interfaces:**
- Produces: routes `/replies`, `/replies/[id]`; nav item with badge; settings card actions (Sync now).

- [ ] **Step 1: data helpers in `src/lib/data.ts`**

```ts
export async function getReplyThreads(): Promise<
  (EmailThread & { org_name: string | null; last_body: string | null; last_direction: string | null })[]
> {
  const profile = await getCurrentProfile();
  if (!profile) return [];
  const supabase = await createClient();
  const { data: threads } = await supabase
    .from("email_threads")
    .select("*")
    .eq("user_id", profile.id)
    .order("last_message_at", { ascending: false })
    .limit(100);
  const list = (threads ?? []) as EmailThread[];
  if (list.length === 0) return [];
  const orgIds = [...new Set(list.map((t) => t.org_id).filter(Boolean))] as number[];
  const { data: orgs } = orgIds.length
    ? await supabase.from("organizations").select("id, name").in("id", orgIds)
    : { data: [] };
  const orgNames = new Map((orgs ?? []).map((o) => [o.id as number, o.name as string]));
  const threadIds = list.map((t) => t.id);
  const { data: lastMessages } = await supabase
    .from("email_messages")
    .select("thread_id, body, direction, sent_at")
    .in("thread_id", threadIds)
    .order("sent_at", { ascending: false });
  const lastByThread = new Map<number, { body: string; direction: string }>();
  for (const m of lastMessages ?? []) {
    if (!lastByThread.has(m.thread_id as number)) {
      lastByThread.set(m.thread_id as number, { body: m.body as string, direction: m.direction as string });
    }
  }
  return list.map((t) => ({
    ...t,
    org_name: t.org_id ? (orgNames.get(t.org_id) ?? null) : null,
    last_body: lastByThread.get(t.id)?.body ?? null,
    last_direction: lastByThread.get(t.id)?.direction ?? null,
  }));
}

export async function getReplyThread(id: number): Promise<{
  thread: EmailThread;
  messages: EmailMessage[];
} | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const supabase = await createClient();
  const { data: thread } = await supabase
    .from("email_threads")
    .select("*")
    .eq("id", id)
    .eq("user_id", profile.id)
    .maybeSingle();
  if (!thread) return null;
  const { data: messages } = await supabase
    .from("email_messages")
    .select("*")
    .eq("thread_id", id)
    .order("sent_at", { ascending: true });
  return { thread: thread as EmailThread, messages: (messages ?? []) as EmailMessage[] };
}
```

- [ ] **Step 2: `/replies` page (list) + `/replies/[id]` (conversation)**

Server pages fetching the above; thread rows link to `/replies/[id]`; unread dot when `unread > 0`; relative date via `toISOString().slice(0, 10)`; snippet = first line of `last_body`. On the thread page, mark thread read on load (`admin` update `unread: 0` scoped to `user_id`), render messages (`out` right-aligned muted card, `in` left card, "has attachment" note), then `<ReplyBox threadId=… />`.

- [ ] **Step 3: `src/components/reply-thread.tsx` (client)**

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Send } from "lucide-react";

export function ReplyThread({ threadId }: { threadId: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [posting, startPosting] = useTransition();
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    // Throttled background sync when the page opens.
    fetch("/api/email/sync", { method: "POST" }).then(() => router.refresh()).catch(() => {});
  }, [router]);

  function send() {
    if (!text.trim() || posting) return;
    setError("");
    startPosting(async () => {
      const res = await fetch("/api/email/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, text }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setText("");
        router.refresh();
      } else {
        setError(data.error ?? "Send failed");
      }
    });
  }

  async function syncNow() {
    setSyncing(true);
    await fetch("/api/email/sync", { method: "POST" }).catch(() => {});
    setSyncing(false);
    router.refresh();
  }

  return (
    <div className="mt-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Write your reply…"
        className="input min-h-[110px] w-full resize-y"
      />
      {error ? (
        <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={syncNow} disabled={syncing} className="btn-ghost">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button type="button" onClick={send} disabled={posting || !text.trim()} className="btn-primary">
          {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
          Send reply
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: sidebar nav + badge**

`SidebarNav` gains prop `unreadReplies: number`; add item `{ href: "/replies", label: "Replies", icon: Mail }` in the ADMIN section above Settings, with a count pill when `unreadReplies > 0`. `Shell` passes it through; `(app)/layout.tsx` computes `await getUnreadReplyCount(adminClient, profile.id)` (admin client to read threads across RLS safely by user id — or the user client: RLS allows own rows; use `createClient`).

- [ ] **Step 5: company page "Emails" section**

In `src/app/(app)/companies/[id]/page.tsx`, fetch the user's threads for the org (`getReplyThreads()` filter `org_id === company.id` — or a dedicated query) and render a small list under the existing sections: subject, counterparty, last activity, unread dot, link `/replies/[id]`. Hide when empty.

- [ ] **Step 6: settings → email "Reply sync" card**

Append below the deliverability tips card: status line (`imap_last_sync_at` → "Last checked <date>", `imap_last_error` → warning), an IMAP host input inside the existing SMTP form? v1: display-only + a **Sync now** client button (reuse `fetch("/api/email/sync")`). Get settings via `getMyEmailSettings` (extend the select with the new fields).

- [ ] **Step 7: UI E2E**

- Seed a thread + 2 messages (1 out, 1 in, unread 1) for a test user via service key → `/replies` lists it with dot; open thread → messages render; badge shows 1; reply box sends (SMTP will fail for a fake host → assert friendly error path) — for the success path, reuse the copied-credentials trick from Task 3.
- Company page shows the thread when `org_id` set.
- Settings card renders status.
- Cleanup.

- [ ] **Step 8: Lint + build + commit + deploy**

```bash
npm run lint && npm run build
git add -A
git commit -m "feat(replies): Replies section, thread view, sidebar badge, company threads, settings card"
git push
```

---

### Task 5: Full E2E + docs + final review

- [ ] **Step 1: Full pass** — rerun Task 3's live sync E2E + Task 4's UI E2E in one script; confirm: outbound appears; synthetic reply appears; unrelated mail ignored; unread badge; reply-from-portal threads (message stored); cleanup zero leftovers.
- [ ] **Step 2: Docs** — README: new env note (none), "Replies" feature section (IMAP read-only, app password, reply-only capture, 2-min sync); ledger append with verification results.
- [ ] **Step 3: Final commit + whole-branch review** (subagent-driven flow): `review-package <base> HEAD`, dispatch the final reviewer, fix any Critical/Important, re-review.

---

## Self-Review Notes

- Spec coverage: reply-only capture ✓ (Task 1 matcher + Task 3 sync), personal RLS ✓ (Task 1), read-only INBOX ✓ (Task 3 `readOnly: true`), outbound message-id ✓ (Task 2), reply-from-portal threading ✓ (Task 2), badge/list/thread/company/settings ✓ (Task 4), caps + throttle ✓ (Task 3), attachments note ✓ (Task 3 `hasAttachments` + Task 4 note), deps limited to imapflow+postal-mime ✓.
- Type consistency: `MatchIndex`/`InboundHeaders` defined in Task 1 and consumed in Tasks 2–3; `EmailThread`/`EmailMessage` in Task 1 used by Task 4; `sendEmailViaSmtp` return change is consumed in Task 2 only (send + reply).
- Known gotcha recorded: `getMatchIndex` returns `messageToThread` (extra) — typed accordingly; admin client required for writes on the new tables (RLS grants SELECT only).
