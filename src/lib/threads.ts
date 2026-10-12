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
  // `${fromEmail}|${normalizeSubject(subject)}` -> message id (latest wins).
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
    const anchor = index.subjects.get(`${from}|${normalizeSubject(msg.subject)}`);
    if (anchor) return { anchorMessageId: anchor };
  }
  return null;
}
