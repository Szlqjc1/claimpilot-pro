import { PrismaClient } from "@prisma/client";
import { seedDatabase } from "../src/lib/seed/run";

const prisma = new PrismaClient();

seedDatabase(prisma, { log: (m) => console.log(`[seed] ${m}`) })
  .then((s) => {
    console.log(`[seed] ${s.claims} claims · ${JSON.stringify(s.byStatus)} · ${s.categories} categories · ${s.flaggedHistorical} flagged historical`);
    if (s.unexpectedFindings.length) console.warn(`[seed] unplanned findings:\n  ${s.unexpectedFindings.join("\n  ")}`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
