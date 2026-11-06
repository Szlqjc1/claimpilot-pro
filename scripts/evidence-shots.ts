// Manual-evidence captures for docs/images/manual/auth-*.png and roles-*.png (Task 11). Reproducible and guarded:
// refuses to run unless the app is in mock mode (scripts/lib/guards.ts). Each capture carries a small banner with
// the URL it was taken at, because a page screenshot shows no address bar and two login-page states would
// otherwise be indistinguishable.
// Usage: pnpm db:seed && pnpm dev, then `pnpm evidence:shots`. Posts CLM-2026-0067 — run `pnpm db:seed` afterwards.
import path from "node:path";
import { chromium, type Page } from "playwright";
import { DEMO_ACCOUNTS } from "../src/lib/auth/demo-accounts";
import { requireMockMode, requireServer, requireServerMock } from "./lib/guards";

const BASE = process.env.SHOTS_BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/images/manual");
const reviewer = DEMO_ACCOUNTS.find((a) => a.role === "reviewer")!;
const requester = DEMO_ACCOUNTS.find((a) => a.role === "requester")!;

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(600);
}

/** Banner with the capture's label and the page's own URL (path + query), then the screenshot. */
async function capture(page: Page, file: string, label: string, opts: { fullPage?: boolean } = {}) {
  await page.evaluate(
    ({ label, url }) => {
      const b = document.createElement("div");
      b.id = "evidence-banner";
      b.textContent = `Evidence · ${label} · URL: ${url}`;
      // Bottom-left, click-through: it must never cover or intercept a control the script uses next.
      b.setAttribute("style", "position:fixed;left:12px;bottom:12px;z-index:99999;pointer-events:none;padding:6px 10px;border-radius:6px;font:600 12px system-ui;color:#fff;background:#122c47;max-width:70%");
      document.body.appendChild(b);
    },
    { label, url: new URL(page.url()).pathname + new URL(page.url()).search },
  );
  await page.screenshot({ path: path.join(OUT, file), fullPage: opts.fullPage });
  await page.evaluate(() => document.getElementById("evidence-banner")?.remove());
  console.log(`✔ ${file}`);
}

const badge = (page: Page) => () => page.locator('[title^="AI mode:"]').first().getAttribute("title");

async function main() {
  requireMockMode();
  await requireServer(BASE, "pnpm evidence:shots");
  const browser = await chromium.launch();
  try {
    // ── auth: signed out → redirect → wrong password → signed in → signed out ───────────────────────────────
    const anon = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await anon.goto(`${BASE}/claims/CLM-2026-0142`);
    await anon.waitForURL("**/login?next=**");
    await settle(anon);
    await capture(anon, "auth-01-redirect-to-login.png", "signed out, opened a claim → redirected to sign-in with next");

    await anon.getByLabel("Email").fill(reviewer.email);
    await anon.getByLabel("Password").fill("Wrong-Password-123");
    await anon.getByRole("button", { name: "Sign in" }).click();
    await anon.locator("#login-error").filter({ hasText: /invalid email or password/i }).waitFor();
    await settle(anon);
    await capture(anon, "auth-02-invalid-credentials.png", "wrong password → generic error");

    await anon.getByLabel("Password").fill(reviewer.password);
    await anon.getByRole("button", { name: "Sign in" }).click();
    await anon.waitForURL("**/claims/CLM-2026-0142");
    await requireServerMock(badge(anon));
    await anon.goto(`${BASE}/dashboard`);
    await settle(anon);
    await capture(anon, "auth-03-signed-in-reviewer.png", "signed in as the reviewer (topbar)");

    await anon.getByRole("button", { name: "Sign out" }).click();
    await anon.waitForURL((u) => u.pathname === "/login");
    await settle(anon);
    await capture(anon, "auth-04-signed-out.png", "after Sign out → sign-in page, no next parameter");
    await anon.close();

    // ── roles: requester ────────────────────────────────────────────────────────────────────────────────────
    const req = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const rp = await req.newPage();
    if (!(await rp.request.post(`${BASE}/api/auth/login`, { data: { email: requester.email, password: requester.password } })).ok()) throw new Error("requester sign-in failed; run pnpm db:seed");
    await rp.goto(`${BASE}/claims/new`);
    await settle(rp);
    await capture(rp, "roles-01-requester-new-claim-readonly.png", "requester: employee and department are read-only, from the session");
    await rp.goto(`${BASE}/claims/CLM-2026-0075`);
    await settle(rp);
    await rp.getByText("Only a reviewer or admin can resolve exceptions and post to SAP.").first().scrollIntoViewIfNeeded();
    await capture(rp, "roles-02-requester-no-review-actions.png", "requester: no Resolve / Waive / Post, reason shown");
    await req.close();

    // ── roles: reviewer ─────────────────────────────────────────────────────────────────────────────────────
    const rev = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const vp = await rev.newPage();
    if (!(await vp.request.post(`${BASE}/api/auth/login`, { data: { email: reviewer.email, password: reviewer.password } })).ok()) throw new Error("reviewer sign-in failed; run pnpm db:seed");
    await vp.goto(`${BASE}/claims/CLM-2026-0073`);
    await settle(vp);
    await requireServerMock(badge(vp));
    await vp.getByText("You submitted this claim, so another reviewer must resolve and post it.").first().scrollIntoViewIfNeeded();
    await capture(vp, "roles-03-reviewer-own-claim-blocked.png", "reviewer on a claim they submitted: Post to SAP blocked");

    const patch = await vp.request.patch(`${BASE}/api/claims/CLM-2026-0067/exceptions/EXC-2026-0067-R-08`, { data: { status: "Resolved", note: "Benchmark variance explained by expedited CMM recalibration; quote attached." } });
    if (!patch.ok()) throw new Error(`resolve failed (${patch.status()}): run pnpm db:seed`);
    const post = await vp.request.post(`${BASE}/api/claims/CLM-2026-0067/post`);
    if (!post.ok()) throw new Error(`post failed (${post.status()})`);
    await vp.goto(`${BASE}/claims/CLM-2026-0067`);
    await settle(vp);
    await capture(vp, "roles-04-reviewer-resolved-and-posted.png", "reviewer resolved the exception (by Priya Natarajan) and posted to SAP", { fullPage: true });
    await rev.close();
  } finally {
    await browser.close();
  }
  console.log("Done. CLM-2026-0067 is now Posted: run `pnpm db:seed` to reset.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
