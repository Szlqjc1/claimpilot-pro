// Regenerates synthetic receipts (original.svg) and mock fixtures (fixture.json) without touching the DB.
// The seed calls the same code; this script exists for inspecting or refreshing the files on their own.
import { buildSeedPlan } from "../src/lib/seed/run";
import { receiptsRoot, writeReceiptFile } from "../src/lib/receipts/storage";

async function main() {
  const plan = buildSeedPlan();
  for (const c of plan.claims) {
    const { svg, fixture } = plan.fixtures.get(c.claimId)!;
    await writeReceiptFile(c.claimId, "original.svg", svg);
    await writeReceiptFile(c.claimId, "fixture.json", JSON.stringify(fixture, null, 2));
  }
  console.log(`Wrote ${plan.claims.length} receipts + fixtures to ${receiptsRoot()}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
