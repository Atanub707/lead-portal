// Matches a person's name to an email address found on the same site.
// Deliberately conservative — only name-carrying locals match:
//   dorian.ciavarella@… , dciavarella@… , dorianc@… , ciavarella@… (single-part names)
// Generic inboxes (info@, sales@…) never match a person.
const GENERIC_LOCALS = new Set([
  "info",
  "sales",
  "contact",
  "hello",
  "support",
  "admin",
  "office",
  "team",
  "press",
  "media",
  "careers",
  "jobs",
  "billing",
  "help",
  "hr",
  "marketing",
  "legal",
  "partners",
]);

export function matchEmailToContact(
  name: string,
  emails: string[]
): string | null {
  const parts = name
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length >= 2);
  if (parts.length === 0) return null;

  const first = parts[0];
  const last = parts[parts.length - 1];

  for (const email of emails) {
    const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!local || GENERIC_LOCALS.has(local)) continue;
    if (parts.every((part) => local.includes(part))) return email;
    if (parts.length >= 2) {
      if (local === `${first[0]}${last}`) return email;
      if (local === `${first}${last[0]}`) return email;
    }
  }
  return null;
}
