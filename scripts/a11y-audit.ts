// Accessibility evidence for docs/ACCESSIBILITY.md. Read-only: opens and cancels dialogs, never submits.
// Runs axe-core (already installed as a transitive dependency of eslint-plugin-jsx-a11y; no new dependency) against
// five pages, records real keyboard tab orders and dialog focus behaviour, and measures colour contrast by painting
// each computed colour onto a canvas (Tailwind 4 colours are oklch). Usage: `pnpm dev`, then `pnpm a11y:audit`.
import { readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { DEMO_ACCOUNTS } from "../src/lib/auth/demo-accounts";

const BASE = process.env.A11Y_BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs/images/manual");
const AXE_DIR = readdirSync(path.resolve("node_modules/.pnpm")).find((d) => d.startsWith("axe-core@"));
const AXE = AXE_DIR ? path.resolve("node_modules/.pnpm", AXE_DIR, "node_modules/axe-core/axe.min.js") : null;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type AxeSummary = { page: string; violations: { id: string; impact: string | null; help: string; nodes: number; targets: string[] }[]; passes: number; incomplete: number };

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(600);
}

async function axe(page: Page, label: string, slug: string): Promise<AxeSummary> {
  await page.addScriptTag({ path: AXE! });
  const res = (await page.evaluate(async (tags) => {
    // @ts-expect-error axe is injected above
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return {
      violations: r.violations.map((v: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) })),
      passes: r.passes.length,
      incomplete: r.incomplete.length,
    };
  }, TAGS)) as Omit<AxeSummary, "page">;
  const summary = { page: label, ...res };
  const n = summary.violations.reduce((s, v) => s + v.nodes, 0);
  await page.evaluate(
    ({ text, ok }) => {
      const b = document.createElement("div");
      b.textContent = text;
      b.setAttribute("style", `position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 12px;border-radius:8px;font:600 13px system-ui;color:#fff;background:${ok ? "#067647" : "#b42318"}`);
      document.body.appendChild(b);
    },
    { text: `axe-core ${AXE_DIR?.split("@")[1]} · WCAG 2.2 A/AA · ${summary.violations.length} rule violation(s), ${n} node(s)`, ok: summary.violations.length === 0 },
  );
  await page.screenshot({ path: path.join(OUT, `axe-${slug}.png`) });
  return summary;
}

/** What the keyboard user is on: role/tag plus an accessible-name approximation. */
const describeFocus = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "(body)";
    const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
    const name = (el.getAttribute("aria-label") ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.innerText ?? (el as HTMLInputElement).placeholder ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const inDialog = !!el.closest('[role="dialog"]');
    return `${role}${name ? ` "${name}"` : ""}${inDialog ? " [in dialog]" : ""}`;
  });

async function tabs(page: Page, n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    out.push(await describeFocus(page));
  }
  return out;
}

/** Open a dialog from its trigger with the keyboard, walk Tab inside it, close with Escape, report where focus lands. */
async function dialogCheck(page: Page, trigger: import("playwright").Locator, tabCount: number) {
  await trigger.focus();
  const triggerName = await describeFocus(page);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  const onOpen = await describeFocus(page);
  const order = await tabs(page, tabCount);
  const trapped = order.every((d) => d.endsWith("[in dialog]"));
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const afterClose = await describeFocus(page);
  return { trigger: triggerName, focusOnOpen: onOpen, tabOrderInside: order, focusTrapped: trapped, focusAfterEscape: afterClose, returnedToTrigger: afterClose === triggerName };
}

async function contrast(page: Page) {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const rgb = (css: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: string, b: string) => {
      const [l1, l2] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
      return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
    };
    const hex = (css: string) => `#${rgb(css).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const root = getComputedStyle(document.documentElement);
    const token = (n: string) => root.getPropertyValue(n).trim();
    const tokens = ["--color-muted", "--color-success", "--color-warning", "--color-danger", "--color-info", "--color-accent-strong", "--color-ink"].map((t) => ({
      pair: `${t} on white`,
      fg: hex(token(t)),
      bg: "#ffffff",
      ratio: ratio(token(t), "#ffffff"),
    }));
    tokens.push({ pair: "--color-muted on --color-canvas (page background)", fg: hex(token("--color-muted")), bg: hex(token("--color-canvas")), ratio: ratio(token("--color-muted"), token("--color-canvas")) });
    // Badges: render each tone's real classes and read the computed colours.
    const tones: Record<string, string> = {
      neutral: "border-slate-200 bg-slate-50 text-slate-700",
      amber: "border-amber-200 bg-amber-50 text-warning",
      blue: "border-blue-200 bg-blue-50 text-info",
      green: "border-emerald-200 bg-emerald-50 text-success",
      red: "border-red-200 bg-red-50 text-danger",
      orange: "border-orange-200 bg-orange-50 text-accent-strong",
      navy: "border-navy-800 bg-navy-900 text-white",
    };
    const badges = Object.entries(tones).map(([tone, cls]) => {
      const el = document.createElement("span");
      el.className = `inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`;
      el.textContent = "Badge";
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { pair: `badge ${tone}`, fg: hex(cs.color), bg: hex(cs.backgroundColor), ratio: ratio(cs.color, cs.backgroundColor) };
      el.remove();
      return out;
    });
    return [...tokens, ...badges];
  });
}

async function main() {
  if (!AXE) throw new Error("axe-core not found under node_modules/.pnpm (it ships with eslint-plugin-jsx-a11y).");
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const evidence: Record<string, unknown> = { capturedWith: `Playwright Chromium ${browser.version()}, axe-core ${AXE_DIR!.split("@")[1]}, tags ${TAGS.join(", ")}`, base: BASE };
  try {
    // Signed out: /login.
    // tsx (esbuild keepNames) wraps named functions in __name(); give the page a no-op so evaluate() bodies run.
    const shim = "globalThis.__name = globalThis.__name || ((f) => f);";
    const anon = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await anon.addInitScript(shim);
    await anon.goto(`${BASE}/login`);
    await settle(anon);
    const loginTabs = await tabs(anon, 6);
    const axeLogin = await axe(anon, "/login", "login");
    await anon.close();

    // Signed in as the demo reviewer.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(shim);
    const page = await ctx.newPage();
    const priya = DEMO_ACCOUNTS.find((a) => a.role === "reviewer")!;
    const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: priya.email, password: priya.password } });
    if (!login.ok()) throw new Error(`Sign-in failed (${login.status()}); run pnpm db:seed`);

    await page.goto(`${BASE}/dashboard`);
    await settle(page);
    const dashboardTabs = await tabs(page, 12);
    await page.goto(`${BASE}/dashboard`);
    await settle(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const skipLinkTarget = await page.evaluate(() => (document.activeElement as HTMLElement)?.id || document.activeElement?.tagName.toLowerCase());
    const afterSkip = await tabs(page, 3);
    const axeDashboard = await axe(page, "/dashboard", "dashboard");
    const measured = await contrast(page);

    await page.goto(`${BASE}/claims/CLM-2026-0142`);
    await settle(page);
    const claimTabs = await tabs(page, 18);
    const axeClaim = await axe(page, "/claims/CLM-2026-0142", "claim-0142");

    // Exception dialog: CLM-2026-0075 (Plant Operations, submitted by Tyler Brooks, one open finding, routed to Priya).
    await page.goto(`${BASE}/claims/CLM-2026-0075`);
    await settle(page);
    const exceptionDialog = await dialogCheck(page, page.getByRole("button", { name: /Not an exception/ }), 8);

    // Post dialog: an auto-approved claim with no open exceptions that Priya did not submit.
    await page.goto(`${BASE}/claims/CLM-2026-0065`);
    await settle(page);
    const postDialog = await dialogCheck(page, page.getByRole("button", { name: /Post to SAP/ }), 6);

    await page.goto(`${BASE}/queue`);
    await settle(page);
    const axeQueue = await axe(page, "/queue", "queue");
    await page.goto(`${BASE}/economics`);
    await settle(page);
    const axeEconomics = await axe(page, "/economics", "economics");

    // Narrow viewport: does the exceptions table scroll horizontally?
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/claims/CLM-2026-0075`);
    await settle(page);
    const narrow = await page.evaluate(() => {
      const t = [...document.querySelectorAll("table")].find((x) => x.textContent?.includes("Anomaly type"));
      const box = t?.parentElement;
      return { exceptionsTableScrollsHorizontally: !!box && box.scrollWidth > box.clientWidth, pageScrollsHorizontally: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });

    Object.assign(evidence, {
      keyboard: { login: loginTabs, dashboard: dashboardTabs, skipLink: { focusAfterActivate: skipLinkTarget, nextTabs: afterSkip }, claimReview: claimTabs, exceptionDialog, postDialog },
      axe: [axeLogin, axeDashboard, axeClaim, axeQueue, axeEconomics],
      contrast: measured,
      narrowViewport390: narrow,
    });
    await ctx.close();
  } finally {
    await browser.close();
  }
  await writeFile(path.join(OUT, "a11y-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
