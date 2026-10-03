export interface NormalizedLead {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  companyLinkedinUrl: string | null;
  companyPhone: string | null;
  companyAddress: string | null;
  companyFounded: number | null;
  employeeCount: number | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function fromRecord(value: unknown, keys: string[]): string | null {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (!record) continue;
    for (const key of keys) {
      const found = str(record[key]);
      if (found) return found;
    }
  }
  return null;
}

export function normalizeApolloLead(raw: unknown): NormalizedLead | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name =
    str(r.fullName) ??
    str(r.name) ??
    [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  if (!name || name.length < 2) return null;
  return {
    name,
    title: str(r.title) ?? str(r.jobTitle) ?? str(r.headline),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone) ?? str(r.mobilePhone) ?? null,
    linkedinUrl: str(r.linkedinUrl) ?? str(r.linkedin) ?? str(r.linkedin_url),
    companyLinkedinUrl:
      str(r.companyLinkedinUrl) ?? str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded:
      typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}

export function needsDeepResearch(input: {
  contacts: {
    is_decision_maker: boolean;
    email: string | null;
    phone: string | null;
    linkedin_url: string | null;
  }[];
  companyEmailCount: number;
  activeRunId: number | null;
  lastSuccessAt: string | null;
}): boolean {
  if (input.activeRunId) return true; // show the running card instead of the button
  const decisionMaker = input.contacts.some((c) => c.is_decision_maker);
  if (decisionMaker) return false;
  const reachable = input.contacts.filter(
    (c) => c.email || c.phone || c.linkedin_url
  ).length;
  const thin =
    input.contacts.length === 0 || reachable === 0 || input.companyEmailCount === 0;
  if (!thin) return false;
  if (
    input.lastSuccessAt &&
    Date.now() - new Date(input.lastSuccessAt).getTime() < 7 * 86_400_000
  ) {
    return false;
  }
  return true;
}

export function normalizeLinkedInEmployee(raw: unknown): NormalizedLead | null {
  const r = asRecord(raw);
  if (!r) return null;
  const name =
    str(r.fullName) ??
    str(r.name) ??
    [str(r.firstName), str(r.lastName)].filter(Boolean).join(" ");
  if (!name || name.length < 2) return null;
  const positions = r.currentPosition ?? r.currentPositions;
  return {
    name,
    title:
      str(r.title) ??
      str(r.jobTitle) ??
      fromRecord(positions, ["title"]) ??
      fromRecord(r.experience, ["position", "title"]) ??
      str(r.position) ??
      str(r.headline),
    email: str(r.email)?.toLowerCase() ?? null,
    phone: str(r.phone) ?? str(r.mobilePhone) ?? null,
    linkedinUrl: str(r.linkedinUrl) ?? str(r.profileUrl) ?? str(r.linkedin_url),
    companyLinkedinUrl:
      fromRecord(positions, ["companyLinkedinUrl", "companyLinkedInUrl"]) ??
      fromRecord(r.experience, ["companyLinkedinUrl", "companyLinkedInUrl"]) ??
      str(r.companyLinkedinUrl) ??
      str(r.organizationLinkedinUrl),
    companyPhone: str(r.companyPhone) ?? null,
    companyAddress: str(r.companyAddress) ?? null,
    companyFounded:
      typeof r.companyFounded === "number" ? r.companyFounded : null,
    employeeCount: typeof r.employeeCount === "number" ? r.employeeCount : null,
  };
}
