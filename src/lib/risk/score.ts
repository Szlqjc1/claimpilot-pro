import type { Decision, RiskLevel } from "@/lib/domain/constants";
import { RULES } from "./rules";
import type { Finding, RiskInput, RiskResult } from "./types";

const LEVEL_RANK: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };

export function scoreBand(score: number): RiskLevel {
  if (score >= 60) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

/** Final level = max(score band, highest-severity finding). */
export function finalLevel(score: number, findings: Finding[]): RiskLevel {
  return findings.reduce<RiskLevel>(
    (lvl, f) => (LEVEL_RANK[f.riskLevel] > LEVEL_RANK[lvl] ? f.riskLevel : lvl),
    scoreBand(score),
  );
}

export function decide(level: RiskLevel, findingCount: number): Decision {
  if (level === "High") return "ESCALATE";
  if (level === "Medium") return "REVIEW";
  return findingCount === 0 ? "AUTO_APPROVE" : "REVIEW";
}

/** Pure, synchronous, deterministic. The LLM never touches this. */
export function evaluateRisk(input: RiskInput): RiskResult {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const f = rule.evaluate(input, findings);
    if (f) findings.push(f);
  }
  const score = Math.min(100, findings.reduce((s, f) => s + f.points, 0));
  const riskLevel = finalLevel(score, findings);
  return { score, riskLevel, decision: decide(riskLevel, findings.length), findings };
}
