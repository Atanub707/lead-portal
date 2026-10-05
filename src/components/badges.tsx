import {
  AVATAR_PRESETS,
  KIND_LABEL,
  STATUS_LABEL,
  type OrgKind,
  type PipelineStage,
} from "@/lib/types";

const STATUS_DOT: Record<PipelineStage, string> = {
  new: "bg-zinc-300",
  contacted: "bg-blue-500",
  demo: "bg-violet-500",
  scoping: "bg-violet-500",
  proposal: "bg-amber-500",
  won: "bg-emerald-500",
  lost: "bg-rose-400",
};

export function StatusDot({ status }: { status: PipelineStage }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-zinc-700">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

const KIND_PILL: Record<OrgKind, string> = {
  lead: "bg-zinc-100 text-zinc-600",
  partner: "bg-sky-50 text-sky-700",
  competitor: "bg-rose-50 text-rose-700",
  other: "bg-zinc-100 text-zinc-600",
};

export function KindBadge({ kind }: { kind: OrgKind }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${KIND_PILL[kind]}`}
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

const AVATAR_GRADIENTS = [
  "from-amber-400 to-amber-600",
  "from-pink-400 to-pink-600",
  "from-sky-400 to-blue-600",
  "from-emerald-400 to-emerald-600",
  "from-violet-400 to-violet-600",
  "from-orange-400 to-orange-600",
  "from-cyan-400 to-cyan-600",
  "from-rose-400 to-rose-600",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function CompanyAvatar({
  name,
  size = 24,
}: {
  name: string;
  size?: number;
}) {
  const style = AVATAR_GRADIENTS[hashString(name) % AVATAR_GRADIENTS.length];
  const letter = name.trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded bg-gradient-to-br font-semibold text-white ring-1 ring-black/5 ${style}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.45)),
      }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

// Cartoon display pictures: a stable emoji + gradient per person, derived from
// their user id (no storage needed). Covers the fun range — people, animals,
// robots — and stays consistent everywhere the person appears.
const PERSON_EMOJIS = [
  "👨",
  "👩",
  "🧑",
  "👨‍💻",
  "👩‍💻",
  "🧔",
  "👩‍🦰",
  "👨‍🦱",
  "👩‍🦳",
  "🐱",
  "🦊",
  "🦇",
  "🦁",
  "🐼",
  "🐸",
  "🦉",
  "🐙",
  "🤖",
  "🦄",
  "🐯",
  "🐨",
  "🐵",
];

export function isCustomAvatar(
  avatar: string | null | undefined
): avatar is string {
  return !!avatar && /^https?:\/\//.test(avatar);
}

export function UserAvatar({
  seed,
  name,
  avatar,
  size = 22,
  title,
}: {
  seed?: string | null;
  name?: string | null;
  avatar?: string | null;
  size?: number;
  title?: string;
}) {
  const custom = isCustomAvatar(avatar);
  const preset =
    avatar && !custom
      ? AVATAR_PRESETS.find((entry) => entry.id === avatar)
      : undefined;
  const key = seed || name || "?";
  const hash = hashString(key);
  const emoji = preset?.emoji ?? PERSON_EMOJIS[hash % PERSON_EMOJIS.length];
  const gradient =
    preset?.gradient ?? AVATAR_GRADIENTS[(hash >>> 5) % AVATAR_GRADIENTS.length];

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br shadow-sm ring-1 ring-black/10 ${gradient}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.52) }}
      title={title ?? name ?? undefined}
      aria-hidden="true"
    >
      {custom ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny user-uploaded avatar, sizing handled here
        <img
          src={avatar}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="translate-y-[0.5px] leading-none">{emoji}</span>
      )}
    </span>
  );
}
