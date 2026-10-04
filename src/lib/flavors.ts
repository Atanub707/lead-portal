// Client-safe flavor definitions — shared by the email composer, the pipeline
// edit dialog, and the server-side generation engine (src/lib/email.ts).

export const FLAVORS = [
  {
    id: "short-direct",
    label: "Short & direct",
    brief: "One value prop, straight to the point. 60-80 words.",
  },
  {
    id: "pain-first",
    label: "Pain-first",
    brief:
      "Open with a problem they likely have, tie it to the pitch. 70-90 words.",
  },
  {
    id: "insight-authority",
    label: "Insight & authority",
    brief:
      "Lead with an insight or deadline relevant to their space, position expertise. 70-90 words.",
  },
  {
    id: "warm-intro",
    label: "Warm intro",
    brief:
      "Reference something specific from their website or profile. Friendly. 70-90 words.",
  },
  {
    id: "founder-founder",
    label: "Founder-to-founder",
    brief: "Peer tone, casual, low-pressure. 50-70 words.",
  },
  {
    id: "follow-up",
    label: "Follow-up",
    brief:
      "Gentle bump. If a prior sent email is provided, reference it; otherwise a short intro. 30-50 words.",
  },
] as const;

export type FlavorId = (typeof FLAVORS)[number]["id"];
