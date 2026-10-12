# Email Replies — In-App Conversations (Portal) — Design

**Date:** 2026-10-12 · **Status:** approved (design), implementation to follow
**Goal:** A portal-native conversation view: every email sent from the portal plus its replies, personal per-member, Gmail-like UX — without ever showing unrelated inbox mail.

## Locked decisions

| Topic | Decision |
| --- | --- |
| Approach | **IMAP sync** (`imapflow`) using the per-user SMTP credentials already stored (app password). Provider presets for Gmail / Outlook / Zoho. |
| Scope of capture | **Replies only.** A message enters the app only if it matches a `Message-ID` we sent (primary) or the safe fallback (sender we emailed + "Re:" subject). Everything else: never fetched, never stored. |
| Visibility | **Personal** — each member sees only their own threads/messages (RLS by `user_id = clerk_user_id()`). |
| Mailbox safety | **Read-only.** We never move, delete, flag, or modify anything; replies still appear in Gmail as normal. Gmail auto-files SMTP sends to Sent already. |
| Freshness | Sync on opening Replies (server-throttled ≥2 min), a "Sync now" button, and later an optional external cron ping. Not real-time push (that is the later Cloudflare route). |
| Outbound | Emails sent from the portal appear in Replies immediately; `Message-ID` saved at send time. Reply-from-portal sends with `In-Reply-To`/`References` so it threads in Gmail too. |
| Attachments | v1: show a "has attachment" note only. No download. |
| AI replies | Out of scope v1 (plain reply box). |

## Data model (migration `20261012100000_email_replies.sql`)

- `sent_emails` += `message_id text`, `in_reply_to text`, `references_ids text`
- `user_email_settings` += `imap_host text`, `imap_last_uid bigint`, `imap_uidvalidity bigint`, `imap_last_sync_at timestamptz`, `imap_last_error text`
- New `email_threads`: `id`, `workspace_id`, `user_id` (mailbox owner), `org_id` (nullable), `contact_id` (nullable), `subject_norm`, `counterparty_email`, `last_message_at`, `unread` int, `created_at`
  - Index: `(user_id, last_message_at desc)`
- New `email_messages`: `id`, `thread_id`, `workspace_id`, `user_id`, `direction` ('out'|'in'), `from_email`, `to_email`, `subject`, `body` (text), `message_id` **unique**, `in_reply_to`, `references_ids`, `has_attachments` bool, `sent_at`, `created_at`
  - Index: `(thread_id, sent_at)`
- RLS on both: select/insert/update only when `user_id = public.clerk_user_id()` (and workspace matches `my_workspace()`); service-role for sync writes.

## Threading rules (single module, pure + tested)

- `normalizeSubject(s)`: strip leading `Re:`/`RE:`/`Fwd:` chains, trim, collapse whitespace.
- Outbound send: find-or-create thread by `(user_id, counterparty_email, subject_norm)`; insert `email_messages` (out) with the send's `message_id`.
- Reply match (sync): `in_reply_to` or any id in `references_ids` ∈ {this user's stored message_ids} → attach to that message's thread.
  - Fallback: `from_email` ∈ {recipient emails of this user's sent_emails} AND `normalizeSubject(subject)` equals a `subject_norm` we sent → attach to the latest matching thread.
  - No match → **drop** (not stored).

## Sync engine (`POST /api/email/sync`)

1. Auth; load the user's settings; require `smtp_user` + password (vault decrypt, memory only). `imap_host` default by preset (Gmail `imap.gmail.com:993 ssl`).
2. Throttle: last sync < 2 min ago → `{ skipped: true, lastSyncAt }`.
3. `imapflow`: connect, open **INBOX read-only**, read `uidValidity`/`uidNext`.
   - UIDVALIDITY changed → reset `imap_last_uid = max(0, uidNext - 200)`.
4. Fetch **headers only** for UIDs > `imap_last_uid` (cap 200; first sync window = last 30 days).
5. For matches only: download source, parse (`postal-mime`) to text, store message (dedupe by unique `message_id`), bump thread (`last_message_at`, `unread + 1`).
6. Persist `imap_last_uid`, `imap_uidvalidity`, `imap_last_sync_at`; on failure store `imap_last_error` (never credentials) and return a friendly status.
7. Work budget ≤ 90 s.

## Sending changes

- `sendEmailViaSmtp` returns `{ messageId }`; accepts optional `{ inReplyTo, references, subject }` for replies.
- `/api/email/send`: store `message_id` on `sent_emails`; insert thread + outbound `email_message`.
- New `POST /api/email/reply` `{ threadId, body }`: sends via SMTP with threading headers (subject = `Re: <thread subject>`), stores outbound message, resets thread unread to 0.

## UI

- **Sidebar → Replies** (Mail icon) with **unread badge** (threads with `unread > 0` for me).
- **`/replies`**: thread list — counterparty, subject, snippet (first line of last message), relative time, unread dot, company link. Filters: All / Unread.
- **`/replies/[id]`**: conversation (in/out bubbles, timestamps, "has attachment" note), reply box + Send; page load fires a throttled background sync; **Sync now** button; connection-error state with a link to Settings.
- **Company page**: an "Emails" section listing that company's threads (my own, personal scope) linking to `/replies/[id]`.
- **Settings → Email**: "Reply sync" card — status (Connected / Not set up / Error + message), IMAP host (prefilled by preset, advanced override), last sync time, Sync now, disconnect note.

## Dependencies

- `imapflow` (MIT, actively maintained, TS) — IMAP client
- `postal-mime` (MIT, modern, zero-dep) — MIME parsing

## Guardrails

- INBOX only, read-only open; headers-first (privacy); 200-msg cap per sync; 30-day first window; credentials decrypt in memory only, never logged; unique `message_id` prevents duplicates; sync idempotent (safe to re-run).
- Personal RLS means even other workspace members (and the super-admin read-only view) cannot see someone's threads.

## Testing

1. **Pure logic**: node script for `normalizeSubject` + reply matcher (synthetic RFC822 header cases: direct reply, reply-all, references chain, subject-edit, non-match).
2. **Outbound E2E**: send from the portal → `sent_emails.message_id` stored, thread + out message created, appears in `/replies`.
3. **Live sync E2E (real mailbox, synthetic reply)**: using the owner's stored credentials via a disposable test user whose settings row is temporarily copied — (a) send a portal email, (b) APPEND a synthetic reply (with `In-Reply-To` = that message id) into INBOX via IMAP, (c) run sync → reply captured into the thread, (d) delete the synthetic message from INBOX, (e) remove test artifacts. Unrelated inbox mail must NOT be stored.
4. **UI E2E**: unread badge, thread view, reply-from-portal (threads in Gmail), company page section, settings card states.

## Out of scope v1

Attachment download, AI-assisted reply drafting, shared/owner-wide view, real-time push (Cloudflare route), notifications beyond the badge, IMAP folders beyond INBOX.
