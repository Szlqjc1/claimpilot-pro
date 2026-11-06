#!/usr/bin/env node
// Runs before `pnpm dev` so that a first-time checkout works without reading the README:
// creates .env from the example when missing, and builds + seeds the database when it is absent.
// It is a no-op once both exist, so it costs nothing on every later run.
import { copyFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const ENV = ".env";
const ENV_EXAMPLE = ".env.example";
const DB = "prisma/dev.db";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.warn(
    `[preflight] Node ${process.versions.node} detected; this project needs Node 22.13 or newer ` +
      `(pnpm 12 uses the built-in node:sqlite module).`,
  );
}

function runPrisma(args) {
  // Resolve the CLI and run it with this Node binary. Spawning it as a command would need a shell on
  // Windows, which Node deprecates for anything but literal argv. `node_modules/.bin` goes on PATH because
  // `prisma db seed` shells out to the seed command (`tsx prisma/seed.ts`), exactly as `pnpm db:seed` does.
  const cli = require.resolve("prisma/build/index.js");
  const bin = path.resolve("node_modules", ".bin");
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` };
  const result = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env });
  if (result.status !== 0) {
    console.error(`\n[preflight] \`prisma ${args.join(" ")}\` failed. Fix the error above, then run \`pnpm db:reset\`.`);
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(ENV) && existsSync(ENV_EXAMPLE)) {
  copyFileSync(ENV_EXAMPLE, ENV);
  console.log("[preflight] created .env from .env.example (mock AI mode — no API key needed)");
}

if (!existsSync(DB)) {
  console.log("[preflight] no database yet — applying migrations and seeding (about 3 seconds)");
  runPrisma(["migrate", "deploy"]);
  runPrisma(["db", "seed"]);
  console.log("[preflight] database ready: 130 demo claims, 3 demo users, 130 receipts");
}
