import "server-only";
import { aiConfig } from "@/lib/ai/provider";
import { ProviderError, askWithDeepSeek } from "@/lib/ai/deepseek";
import type { Facts } from "./retrieve";

// Answering for grounded Q&A (docs/AI_GOVERNANCE.md, DECISIONS D-36).
// Template first: every intent has a deterministic sentence built only from Facts. That is the answer in
// mock mode and the fallback on every failure. In live mode the model may rephrase the same Facts, and its
// text is kept only if every claim id, rule id and dollar amount in it already appears in the Facts.

export type AskResult = { answer: string; citations: string[]; source: "model" | "template"; kind: Facts["kind"] };

export const REFUSAL =
  "I can only answer questions about claim status, vendor spend, policy limits and current priorities. Try naming a claim id, a vendor or a category.";

const yesNo = (b: boolean) => (b ? "required" : "not required");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Deterministic English answer and the ids it relies on. No model, no network. */
export function templateAnswer(facts: Facts): { answer: string; citations: string[] } {
  switch (facts.kind) {
    case "claim_status": {
      const c = facts.claim;
      if (!c) return { answer: `I do not have a claim with id ${facts.claimIdAsked}.`, citations: [] };
      const head = `${c.claimId} is a ${c.amount} ${c.category} claim from ${c.vendorName}, submitted by ${c.employee} (${c.department}) on ${c.submittedOn}. Status: ${c.status}.`;
      if (c.status === "Pending") return { answer: `${head} It has not been audited yet, so there are no findings.`, citations: [c.claimId] };
      const risk = `Risk ${c.riskScore ?? "n/a"}/100 (${c.riskLevel ?? "n/a"}), decision ${c.decision ?? "n/a"}.`;
      if (c.findings.length === 0) return { answer: `${head} ${risk} No exceptions were raised.`, citations: [c.claimId] };
      const findings = c.findings.map((f) => `${f.ruleId} ${f.anomalyType} (+${f.points}, ${f.status}${f.resolvedBy ? ` by ${f.resolvedBy}` : ""})`);
      const more = c.findingCount > c.findings.length ? ` and ${c.findingCount - c.findings.length} more` : "";
      const po = c.po ? ` PO ${c.po.poNumber} has ${c.po.remaining} remaining.` : "";
      const policy = c.policy ? ` The ${c.policy.category} per-claim limit is ${c.policy.perClaimLimit}.` : "";
      const routed = c.assignedRole ? ` Routed to ${c.assignedTo ?? `${c.assignedRole} (no eligible owner)`}.` : "";
      return { answer: `${head} ${risk} Flagged for ${list(findings)}${more}.${po}${policy}${routed}`, citations: [c.claimId, ...c.findings.map((f) => f.ruleId)] };
    }
    case "vendor_spend": {
      const v = facts.vendor;
      if (!v) return { answer: "I could not match that to a vendor in the vendor master. Try the vendor's full name.", citations: [] };
      if (v.claimCount === 0) return { answer: `I have no claims from ${v.name} in the ${v.period.toLowerCase()}.`, citations: [] };
      return {
        answer: `${v.period}: ${v.total} across ${v.claimCount} claim${v.claimCount === 1 ? "" : "s"} from ${v.name}. Latest submission ${v.latestSubmittedOn ?? "unknown"}; largest category ${v.topCategory ?? "unknown"}.`,
        citations: [],
      };
    }
    case "top_risks": {
      const scope = `${facts.period}${facts.department ? `, ${facts.department}` : ""}`;
      if (facts.topByScore.length === 0 && facts.topByPriority.length === 0) return { answer: `I have no analyzed claims for ${scope}.`, citations: [] };
      const byScore = facts.topByScore.map((c) => `${c.claimId} (${c.riskScore}, ${c.vendorName}, ${c.amount})`);
      const byPriority = facts.topByPriority.map((c) => `${c.claimId} (expected loss ${c.expectedLoss}, ${c.action === "REVIEW" ? (c.reason === "CONSTRAINT" ? "always review" : "review") : "clear"})`);
      const parts = [
        byScore.length ? `Highest risk scores among open analyzed claims (${scope}): ${list(byScore)}.` : `No open analyzed claims for ${scope}.`,
        byPriority.length ? `Review first by expected loss per review dollar: ${list(byPriority)}.` : "",
      ].filter(Boolean);
      return { answer: parts.join(" "), citations: [...new Set([...facts.topByScore.map((c) => c.claimId), ...facts.topByPriority.map((c) => c.claimId)])] };
    }
    case "policy": {
      const parts: string[] = [];
      if (facts.policy) {
        const p = facts.policy;
        parts.push(`${p.category}: per-claim limit ${p.perClaimLimit}, approval threshold ${p.approvalThreshold}; PO ${yesNo(p.requiresPo)}, goods receipt ${yesNo(p.requiresGrn)}, project code ${yesNo(p.requiresProjectCode)}.`);
      } else if (facts.category) parts.push(`I do not have a policy row for ${facts.category}.`);
      if (facts.travel) parts.push(`Travel caps: lodging ${facts.travel.lodgingCapPerNight} per night, airfare ${facts.travel.airfareCap}, per diem ${facts.travel.perDiem} per day${facts.travel.economyOnly ? ", economy class only" : ""}.`);
      if (facts.entertainment) parts.push(`Entertainment: ${facts.entertainment.perHeadCap} per head${facts.entertainment.attendeeListRequired ? ", attendee list required" : ""}${facts.entertainment.alcoholDiscouraged ? ", alcohol discouraged" : ""}.`);
      return { answer: parts.length ? parts.join(" ") : "I do not have a policy for that. Name a category, or ask about travel or entertainment caps.", citations: [] };
    }
    default:
      return { answer: REFUSAL, citations: [] };
  }
}

const ID_TOKENS = /\b(CLM-\d{4}-\d{4}|R-\d{2})\b/g;
const MONEY_TOKENS = /\$\d[\d,]*(?:\.\d{1,2})?/g;
const money = (s: string) => (s.replace(/[$,]/g, "").includes(".") ? Number(s.replace(/[$,]/g, "")).toFixed(2) : `${Number(s.replace(/[$,]/g, ""))}.00`);

/**
 * Citation check: every claim id and rule id in the model's text must appear in the serialised Facts, and so
 * must every dollar amount (so the model cannot introduce a number). Returns the cited ids, or null to reject.
 */
export function validateModelAnswer(text: string, factsJson: string): string[] | null {
  const ids = [...new Set(text.match(ID_TOKENS) ?? [])];
  if (ids.some((id) => !factsJson.includes(`"${id}"`) && !factsJson.includes(id))) return null;
  const known = new Set((factsJson.match(MONEY_TOKENS) ?? []).map(money));
  if ((text.match(MONEY_TOKENS) ?? []).some((m) => !known.has(money(m)))) return null;
  return ids;
}

export async function answerQuestion(question: string, facts: Facts, opts: { requestId: string }): Promise<AskResult> {
  const template = templateAnswer(facts);
  const fallback: AskResult = { ...template, source: "template", kind: facts.kind };
  const cfg = aiConfig();
  if (facts.kind === "unknown" || cfg.mode !== "live" || !cfg.apiKey) return fallback;
  const factsJson = JSON.stringify(facts);
  try {
    const text = await askWithDeepSeek(question, factsJson, opts.requestId);
    const cited = validateModelAnswer(text, factsJson);
    if (!cited) {
      console.warn(JSON.stringify({ evt: "ask.citation_rejected", requestId: opts.requestId, kind: facts.kind }));
      return fallback;
    }
    return { answer: text, citations: cited.length ? cited : template.citations, source: "model", kind: facts.kind };
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    return fallback;
  }
}
