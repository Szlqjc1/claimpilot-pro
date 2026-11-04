import { describe, expect, it } from "vitest";
import { auditActionTone, initiatedByOf } from "@/lib/audit/tone";

describe("auditActionTone", () => {
  it("Flagged → red", () => expect(auditActionTone("Automotive Expense Flagged")).toBe("red"));
  it("Validated | Posted → green", () => {
    expect(auditActionTone("Automotive Expense Validated")).toBe("green");
    expect(auditActionTone("Posted to SAP")).toBe("green");
  });
  it("Failed → amber", () => {
    expect(auditActionTone("Audit Failed")).toBe("amber");
    expect(auditActionTone("Sign-in Failed")).toBe("amber");
  });
  it("Resolved | Waived → amber", () => {
    expect(auditActionTone("Exception Resolved")).toBe("amber");
    expect(auditActionTone("Exceptions Resolved")).toBe("amber");
    expect(auditActionTone("Exception Waived")).toBe("amber");
  });
  it("anything else → neutral", () => {
    expect(auditActionTone("Claim Submitted")).toBe("neutral");
    expect(auditActionTone("User Signed In")).toBe("neutral");
  });
});

describe("initiatedByOf", () => {
  it("reads initiatedBy from metadata, tolerating null and bad JSON", () => {
    expect(initiatedByOf(JSON.stringify({ requestId: "x", initiatedBy: "Priya Natarajan" }))).toBe("Priya Natarajan");
    expect(initiatedByOf(JSON.stringify({ initiatedBy: null }))).toBeNull();
    expect(initiatedByOf(null)).toBeNull();
    expect(initiatedByOf("{not json")).toBeNull();
  });
});
