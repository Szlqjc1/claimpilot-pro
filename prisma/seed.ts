import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seed/run";
import { seedDemoUsers } from "../src/lib/auth/demo-accounts";

const prisma = new PrismaClient();

async function main() {
  const s = await seedDatabase(prisma, { log: (m) => console.log(`[seed] ${m}`) });
  console.log(`[seed] ${s.claims} claims · ${JSON.stringify(s.byStatus)} · ${s.categories} categories · ${s.flaggedHistorical} flagged historical`);
  if (s.unexpectedFindings.length) console.warn(`[seed] unplanned findings:\n  ${s.unexpectedFindings.join("\n  ")}`);
  const users = await seedDemoUsers(prisma);
  console.log(`[seed] ${users} demo users (see README "Demo accounts")`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
