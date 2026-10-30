import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL, TEST_RECEIPTS_DIR } from "../../vitest.config";

// Fresh test DB (prisma/test.db) + receipts dir, seeded once per run.
export default async function setup() {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, RECEIPTS_DIR: TEST_RECEIPTS_DIR };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  process.env.RECEIPTS_DIR = TEST_RECEIPTS_DIR;
  const { seedDatabase } = await import("../lib/seed/run");
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
