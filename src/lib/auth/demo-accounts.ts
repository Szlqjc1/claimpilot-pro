import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password";
import type { Role } from "./constants";

// Demo-only credentials, also listed on /login and in README "Demo accounts". Not for production use.

export const DEMO_ACCOUNTS: { id: string; email: string; name: string; role: Role; title: string; password: string }[] = [
  { id: "U-0001", email: "dana.whitfield@joyson.example", name: "Dana Whitfield", role: "admin", title: "Corporate Audit", password: "Joyson-Audit-2026" },
  { id: "U-0002", email: "priya.natarajan@joyson.example", name: "Priya Natarajan", role: "reviewer", title: "Plant Controller", password: "Toledo-Controller-26" },
  { id: "U-0003", email: "marcus.reed@joyson.example", name: "Marcus Reed", role: "requester", title: "R&D Engineering", password: "CrashSled-Request-26" },
];

/** Replace all users (and their sessions) with the demo accounts. */
export async function seedDemoUsers(prisma: PrismaClient): Promise<number> {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({
    data: DEMO_ACCOUNTS.map((a) => ({ id: a.id, email: a.email, name: a.name, role: a.role, passwordHash: hashPassword(a.password) })),
  });
  return DEMO_ACCOUNTS.length;
}
