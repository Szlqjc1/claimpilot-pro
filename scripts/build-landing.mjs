// Builds a self-contained copy of the landing page for a domestic host.
//
// GitHub Pages is blocked on many Chinese campus and office networks, so the page needs a second home that is not
// github.io. This script produces exactly the files such a host needs and nothing else: index.html plus the assets it
// references. It is not published by CI 鈥?run it when the page changes and upload the output.
//
//   pnpm build:landing
//   鈫?deploy/landing/index.html
//   鈫?deploy/landing/assets/*
//
// Upload that folder to Gitee Pages, Tencent COS or any other static host. The page uses relative paths only, so it
// works from any origin without edits (see docs/HOSTING.md).
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "docs");
const out = path.join(root, "deploy", "landing");

const html = await readFile(path.join(src, "index.html"), "utf8");

// Copy the whole assets folder: the page references images from <img src>, <meta og:image> and CSS url() alike, and a
// regex that catches all three is more fragile than copying 0.7 MB. The check below still fails the build if the HTML
// names a file that is not there.
const referenced = new Set([...html.matchAll(/assets\/[A-Za-z0-9._-]+/g)].map((m) => m[0]));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await writeFile(path.join(out, "index.html"), html);
await cp(path.join(src, "assets"), path.join(out, "assets"), { recursive: true });

const copied = (await readdir(path.join(out, "assets"))).length;
const missing = [...referenced].filter((rel) => !existsSync(path.join(src, rel))).sort();

// Some hosts look for this to disable their own Jekyll-style processing; harmless elsewhere.
await writeFile(path.join(out, ".nojekyll"), "");

const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)]
  .map((m) => new URL(m[1]).host)
  .filter((host, i, all) => all.indexOf(host) === i)
  .sort();

console.log(`built ${path.relative(root, out)}`);
console.log(`  index.html  ${(html.length / 1024).toFixed(1)} kB`);
console.log(`  assets      ${copied} copied${missing.length ? `, ${missing.length} MISSING` : ""}`);
for (const rel of missing) console.log(`    missing: ${rel}`);
console.log(`  outbound hosts: ${external.join(", ")}`);

if (missing.length > 0) process.exitCode = 1;
