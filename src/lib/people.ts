const DECISION_TITLE =
  /(founder|co-?founder|ceo|cto|coo|cfo|cmo|owner|president|partner|head of|director)/i;

export function isDecisionTitle(title: string | null): boolean {
  return !!title && DECISION_TITLE.test(title);
}

const GENERIC_LOCALS = new Set([
  "info",
  "sales",
  "support",
  "contact",
  "admin",
  "hello",
  "team",
  "press",
  "media",
  "office",
  "help",
  "billing",
  "hr",
  "jobs",
  "careers",
  "marketing",
]);

export function isGenericEmail(local: string): boolean {
  return GENERIC_LOCALS.has(local.toLowerCase());
}
