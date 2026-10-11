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
  // Common role inboxes in other languages (recipients' filters often treat
  // cold mail to these as spam; they are never a person's own address).
  "contacto",
  "comunicacion",
  "comunicaciones",
  "admon",
  "administracion",
  "rgpd",
  "ventas",
  "comercial",
  "direccion",
  "correo",
  "recepcion",
  "contactus",
  "accueil",
  "kontakt",
  "reception",
  "enquiries",
  "inquiries",
  "reachus",
  "hola",
]);

export function isGenericEmail(local: string): boolean {
  return GENERIC_LOCALS.has(local.toLowerCase());
}
