// Shared by the Edge middleware and Node code, so it must not import Prisma or server-only modules.

export const SESSION_COOKIE = "cp_session";

export const ROLES = ["requester", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  requester: "Requester",
  reviewer: "Reviewer",
  admin: "Admin",
};

/** Only same-site relative paths are allowed as a post-login redirect (no open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) return "/dashboard";
  return next;
}
