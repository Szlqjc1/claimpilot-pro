// Captures README screenshots and audit GIF frames from a running dev server.
// Usage: start the app (`pnpm db:seed` for a fresh demo, then `pnpm dev`), then `pnpm shots`.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/images");
const FRAMES = path.join(OUT, "audit-frames");
const CLAIM = "CLM-2026-0142";

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/kpis`, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Hide the Next.js dev-mode indicator so screenshots show only the app.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // Let Recharts finish its entry animation.
  await page.waitForTimeout(800);
}

async function main() {
  if (!(await probe())) {
    console.error(`Dev server not reachable at ${BASE}. Run \`pnpm dev\` in another terminal, then re-run \`pnpm shots\`.`);
    process.exit(1);
  }
  await mkdir(FRAMES, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`${BASE}/dashboard`);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "dashboard.png") });
    console.log("✔ dashboard.png");

    await page.goto(`${BASE}/claims/${CLAIM}`);
    await settle(page);
    const runButton = page.getByRole("button", { name: "🚀 Run AI-RPA Audit" });
    if (!(await runButton.isVisible())) {
      console.error(`${CLAIM} is already analyzed. Run \`pnpm db:seed\` to reset the demo, then re-run \`pnpm shots\`.`);
      process.exit(1);
    }
    await page.screenshot({ path: path.join(OUT, "claim-pending.png") });
    await page.getByText("AI-RPA audit", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(FRAMES, "01-idle.png") });
    console.log("✔ claim-pending.png, audit-frames/01-idle.png");

    // Hold the audit response briefly so the running state can be captured even in fast mock mode.
    await page.route(`**/api/claims/${CLAIM}/audit`, async (route) => {
      await new Promise((r) => setTimeout(r, 1_500));
      await route.continue();
    });
    await runButton.click();
    await page.getByRole("button", { name: /Running AI-RPA audit/ }).waitFor();
    await page.screenshot({ path: path.join(FRAMES, "02-running.png") });
    console.log("✔ audit-frames/02-running.png");

    await page.getByRole("button", { name: "✅ Audit complete" }).waitFor({ timeout: 90_000 });
    await page.locator("[data-testid=ai-structured-data]").waitFor({ timeout: 30_000 });
    await settle(page);
    // Wait for the success toast to auto-dismiss so it doesn't cover the topbar.
    await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 15_000 }).catch(() => {});
    await page.getByText("AI-RPA audit", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(FRAMES, "03-done.png") });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(OUT, "claim-analyzed.png") });
    console.log("✔ audit-frames/03-done.png, claim-analyzed.png");

    await page.getByText("How this was calculated").click();
    const riskCard = page.locator("section", { has: page.locator("#risk-title") });
    await riskCard.scrollIntoViewIfNeeded();
    await riskCard.screenshot({ path: path.join(OUT, "risk-panel.png") });
    console.log("✔ risk-panel.png");

    await page.goto(`${BASE}/audit`);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "audit-log.png") });
    console.log("✔ audit-log.png");
  } finally {
    await browser.close();
  }
  console.log(`Done → ${OUT}. Run \`pnpm db:seed\` to reset ${CLAIM} to Pending.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
