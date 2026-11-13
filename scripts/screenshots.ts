// Captures README screenshots and audit GIF frames from a running dev server.
// Usage: start the app (`pnpm db:seed` for a fresh demo, then `pnpm dev`), then `pnpm shots`.
// Refuses to run unless AI_MODE is mock (scripts/lib/guards.ts): captures must be deterministic and must not call
// the live model. `pnpm shots --allow-live` overrides.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { DEMO_ACCOUNTS } from "../src/lib/auth/demo-accounts";
import { requireMockMode, requireServer, requireServerMock } from "./lib/guards";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/images");
const FRAMES = path.join(OUT, "audit-frames");
const CLAIM = "CLM-2026-0142";
// Submitted by Elena Vasquez, so the reviewer may handle it; one R-11 exception (not a duplicate).
const HANDLED = "CLM-2026-0143";
// Plant Operations, submitted by Tyler Brooks → routed to Priya, so her "Needs disposition" group has an item.
const ROUTED = "CLM-2026-0147";

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Hide the Next.js dev-mode indicator so screenshots show only the app.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // Let Recharts finish its entry animation.
  await page.waitForTimeout(800);
}

async function main() {
  requireMockMode();
  await requireServer(BASE, "pnpm shots");
  await mkdir(FRAMES, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    // Signed out: every page redirects to /login.
    await page.goto(`${BASE}/dashboard`);
    await page.waitForURL("**/login**");
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "login.png") });
    console.log("✔ login.png");

    // Pages require a session: sign in as Priya Natarajan, the reviewer docs/DEMO_SCRIPT.md uses (the cookie is shared with the page).
    const reviewer = DEMO_ACCOUNTS.find((a) => a.email === "priya.natarajan@joyson.example")!;
    const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: reviewer.email, password: reviewer.password } });
    if (!login.ok()) {
      console.error(`Demo sign-in failed (${login.status()}). Run \`pnpm db:seed\` to create the demo accounts.`);
      process.exit(1);
    }

    await page.goto(`${BASE}/dashboard`);
    await requireServerMock(() => page.locator('[title^="AI mode:"]').first().getAttribute("title"));
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

    // The annotated invoice sits below the 1440x900 fold: capture the card itself, not the page.
    const annotated = page.locator('[data-testid="ai-annotated-invoice"]');
    // The sticky topbar would overlap the card's header in an element shot; let it scroll away for this capture.
    const unstick = await page.addStyleTag({ content: "header.sticky { position: static !important; }" });
    await annotated.scrollIntoViewIfNeeded();
    await annotated.locator("img").evaluate((img: HTMLImageElement) => (img.complete ? null : new Promise((r) => img.addEventListener("load", r, { once: true }))));
    await annotated.screenshot({ path: path.join(OUT, "annotated-invoice.png") });
    console.log("✔ annotated-invoice.png");
    await unstick.evaluate((el) => el.parentNode?.removeChild(el));
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.getByText("How this was calculated").click();
    const riskCard = page.locator("section", { has: page.locator("#risk-title") });
    await riskCard.scrollIntoViewIfNeeded();
    await riskCard.screenshot({ path: path.join(OUT, "risk-panel.png") });
    console.log("✔ risk-panel.png");

    // A claim the reviewer handled: audit, waive its one exception, post. Shows "by …" and the green Posted row.
    const api = async (method: "POST" | "PATCH", url: string, data?: unknown) => {
      const res = await page.request.fetch(`${BASE}${url}`, { method, data });
      if (!res.ok()) throw new Error(`${method} ${url} → ${res.status()} ${await res.text()}`);
      return res.json() as Promise<Record<string, unknown>>;
    };
    const audited = (await api("POST", `/api/claims/${HANDLED}/audit`)) as { exceptions: { exceptionId: string }[] };
    for (const ex of audited.exceptions) {
      await api("PATCH", `/api/claims/${HANDLED}/exceptions/${ex.exceptionId}`, { status: "Waived", note: "Lodging rate approved by SQ manager — city-wide event pricing." });
    }
    await api("POST", `/api/claims/${HANDLED}/post`);
    await page.goto(`${BASE}/claims/${HANDLED}`);
    await settle(page);
    const exceptionsCard = page.locator("section").filter({ has: page.getByText("One row per rule finding") });
    await exceptionsCard.scrollIntoViewIfNeeded();
    await exceptionsCard.screenshot({ path: path.join(OUT, "exceptions-handled.png") });
    console.log("✔ exceptions-handled.png");

    await page.goto(`${BASE}/audit`);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "audit-log.png") });
    console.log("✔ audit-log.png");

    await api("POST", `/api/claims/${ROUTED}/audit`);
    await page.goto(`${BASE}/queue`);
    await settle(page);
    await page.screenshot({ path: path.join(OUT, "queue.png") });
    console.log("✔ queue.png");
  } finally {
    await browser.close();
  }
  console.log(`Done → ${OUT}. Run \`pnpm db:seed\` to reset ${CLAIM}, ${HANDLED} and ${ROUTED}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
