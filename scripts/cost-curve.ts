// Review cost curve (docs/ECONOMICS.md). Read-only against the DB; writes docs/cost-curve.csv and
// docs/images/cost-curve.svg. Usage: `pnpm db:seed` (once), then `pnpm cost:curve`.
// Runs with `--conditions=react-server` because it reuses server-only modules.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { formatUsd } from "../src/lib/domain/money";
import { DEFAULT_ERROR_PROBABILITY, REVIEW_COST_CENTS } from "../src/lib/domain/constants";
import { assessClaims } from "../src/lib/economics/assess";
import { CURVE_CAPACITIES, costCurve } from "../src/lib/risk/economics";
import { costCurveSvg } from "../src/lib/economics/curve-svg";

async function main() {
  const claims = await assessClaims();
  if (claims.length === 0) {
    console.error("No Analyzed claims with an extraction. Run `pnpm db:seed` first.");
    process.exit(1);
  }
  const points = costCurve(claims, REVIEW_COST_CENTS, CURVE_CAPACITIES);

  console.log(`${claims.length} Analyzed claims · p = ${DEFAULT_ERROR_PROBABILITY} · c = ${formatUsd(REVIEW_COST_CENTS)} (demo inputs, DECISIONS D-35)\n`);
  console.log("| Capacity | Reviewed | Review cost | Expected loss not reviewed | Total |");
  console.log("|---:|---:|---:|---:|---:|");
  for (const p of points) console.log(`| ${p.capacityPct}% | ${p.reviewed} | ${formatUsd(p.reviewCostCents)} | ${formatUsd(p.expectedLossCents)} | ${formatUsd(p.totalCents)} |`);

  const csv = ["capacity_pct,reviewed,review_cost_usd,expected_loss_usd,total_usd", ...points.map((p) => [p.capacityPct, p.reviewed, (p.reviewCostCents / 100).toFixed(2), (p.expectedLossCents / 100).toFixed(2), (p.totalCents / 100).toFixed(2)].join(","))].join("\n") + "\n";
  await writeFile(path.resolve("docs/cost-curve.csv"), csv);
  await writeFile(path.resolve("docs/images/cost-curve.svg"), costCurveSvg(points));

  const best = points.reduce((a, b) => (b.totalCents < a.totalCents ? b : a));
  console.log(`\nLowest total cost: ${formatUsd(best.totalCents)} at ${best.capacityPct}% review capacity (${best.reviewed} of ${claims.length} claims reviewed).`);
  console.log("Wrote docs/cost-curve.csv and docs/images/cost-curve.svg");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
