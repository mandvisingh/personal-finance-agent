import { describe, it, expect } from "vitest";
import { prescrubText, detectMode, getMissingFields } from "../index.js";

// ─────────────────────────────────────────────────────────────────────────────
// prescrubText — PII redaction
// ─────────────────────────────────────────────────────────────────────────────
describe("prescrubText", () => {
  it("redacts SSNs", () => {
    expect(prescrubText("SSN: 123-45-6789")).toContain("[SSN REDACTED]");
  });

  it("redacts email addresses", () => {
    expect(prescrubText("Contact: john.doe@example.com")).toContain("[EMAIL REDACTED]");
  });

  it("redacts phone numbers", () => {
    expect(prescrubText("Call me at 415-555-1234")).toContain("[PHONE REDACTED]");
  });

  it("redacts titled names", () => {
    expect(prescrubText("Mr. John Smith made a payment")).toContain("[NAME REDACTED]");
  });

  it("redacts ZIP codes", () => {
    const result = prescrubText("Mailing address ZIP 94102");
    expect(result).toContain("[ZIP REDACTED]");
  });

  it("preserves the last 4 digits of a card number", () => {
    const result = prescrubText("Card: 4111 1111 1111 1234");
    expect(result).toContain("1234");
    expect(result).not.toContain("4111 1111 1111");
  });

  it("does not alter text with no PII", () => {
    const clean = "RENT PAYMENT $1200.00";
    expect(prescrubText(clean)).toBe(clean);
  });

  it("redacts multiple PII types in one string", () => {
    const text = "Mr. John Smith, SSN 123-45-6789, email john@bank.com";
    const result = prescrubText(text);
    expect(result).toContain("[NAME REDACTED]");
    expect(result).toContain("[SSN REDACTED]");
    expect(result).toContain("[EMAIL REDACTED]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectMode — spending vs forecast routing
// ─────────────────────────────────────────────────────────────────────────────
describe("detectMode", () => {
  it("returns 'forecast' for wealth-related keywords", () => {
    expect(detectMode("I want to forecast my savings")).toBe("forecast");
    expect(detectMode("when can I retire?")).toBe("forecast");
    expect(detectMode("project my wealth over 10 years")).toBe("forecast");
    expect(detectMode("how much will I be worth in 5 years")).toBe("forecast");
    expect(detectMode("compound interest on $10k")).toBe("forecast");
    expect(detectMode("invest $500 a month")).toBe("forecast");
  });

  it("returns 'spending' for transaction/analysis input", () => {
    expect(detectMode("here are my transactions")).toBe("spending");
    expect(detectMode("my salary is $5000")).toBe("spending");
    expect(detectMode("I spent too much on food")).toBe("spending");
    expect(detectMode("analyse my bank statement")).toBe("spending");
  });

  it("returns 'spending' for empty or unrecognised input", () => {
    expect(detectMode("")).toBe("spending");
    expect(detectMode("hello")).toBe("spending");
  });

  it("is case-insensitive", () => {
    expect(detectMode("RETIRE early")).toBe("forecast");
    expect(detectMode("FORECAST my money")).toBe("forecast");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getMissingFields — profile completeness check
// ─────────────────────────────────────────────────────────────────────────────
describe("getMissingFields", () => {
  it("returns all three fields when profile is empty", () => {
    const missing = getMissingFields({ salary: null, currentSavings: null, goals: null });
    expect(missing).toContain("monthly income");
    expect(missing).toContain("financial goals");
    expect(missing).toContain("current savings");
    expect(missing).toHaveLength(3);
  });

  it("returns no fields when profile is complete", () => {
    const missing = getMissingFields({ salary: 5000, currentSavings: 10000, goals: "buy a house" });
    expect(missing).toHaveLength(0);
  });

  it("returns only the missing fields", () => {
    const missing = getMissingFields({ salary: 5000, currentSavings: null, goals: null });
    expect(missing).not.toContain("monthly income");
    expect(missing).toContain("financial goals");
    expect(missing).toContain("current savings");
    expect(missing).toHaveLength(2);
  });

  it("treats 0 savings as falsy (missing)", () => {
    // A user with $0 savings should still be prompted
    const missing = getMissingFields({ salary: 5000, currentSavings: 0, goals: "retire" });
    expect(missing).toContain("current savings");
  });
});
