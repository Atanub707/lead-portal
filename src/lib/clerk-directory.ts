import { clerkClient } from "@clerk/nextjs/server";

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: "pending" | "revoked" | "expired" | "accepted";
  createdAt: number;
  expiresAt: number;
  expiresInHours: number;
}

export interface ClerkDirectory {
  activeUsers: Map<string, boolean>;
  invitations: InvitationRow[];
}

// Short cache so prefetches/revisits don't hammer Clerk's API. Mutations call
// clearClerkDirectoryCache() so the list updates instantly after any action.
let cache: { at: number; data: ClerkDirectory } | null = null;
const TTL_MS = 60_000;

export function clearClerkDirectoryCache() {
  cache = null;
}

export async function getClerkDirectory(): Promise<ClerkDirectory | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  try {
    const client = await clerkClient();
    const [users, invites] = await Promise.all([
      client.users.getUserList({ limit: 200 }),
      client.invitations.getInvitationList({ limit: 200 }),
    ]);

    const activeUsers = new Map<string, boolean>();
    for (const user of users.data) activeUsers.set(user.id, true);

    const invitations: InvitationRow[] = (invites.data ?? [])
      .filter((invite) => invite.status !== "accepted")
      .map((invite) => {
        const raw = invite.raw as { expires_at?: number } | null;
        const role = invite.publicMetadata?.role;
        const expiresAt = raw?.expires_at ?? invite.createdAt + 86_400_000;
        return {
          id: invite.id,
          email: invite.emailAddress,
          role: typeof role === "string" ? role : "editor",
          status: invite.status as InvitationRow["status"],
          createdAt: invite.createdAt,
          expiresAt,
          expiresInHours: Math.max(
            0,
            Math.round((expiresAt - Date.now()) / 3_600_000)
          ),
        };
      })
      .sort((a, b) => {
        const aPending = a.status === "pending" ? 0 : 1;
        const bPending = b.status === "pending" ? 0 : 1;
        if (aPending !== bPending) return aPending - bPending;
        return b.createdAt - a.createdAt;
      });

    const data: ClerkDirectory = { activeUsers, invitations };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? null;
  }
}
