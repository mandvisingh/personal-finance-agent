import { describe, it, expect } from "vitest";
import {
  spendingAnalysisTool,
  syncProfileTool,
  wealthForecastTool,
  extractStatementTool,
} from "../tools.js";

// ─────────────────────────────────────────────────────────────────────────────
// spendingAnalysisTool
// ─────────────────────────────────────────────────────────────────────────────
describe("spendingAnalysisTool", () => {
  // No leading dates — the tool's amount regex grabs the first number in each line
  const transactions = [
    "RENT PAYMENT $1200.00",
    "STARBUCKS COFFEE $6.50",
    "UBER RIDE $18.00",
    "NETFLIX SUBSCRIPTION $15.99",
    "DOORDASH ORDER $45.00",
    "GROCERY STORE $120.00",
    "SPOTIFY $9.99",
    "GYM MEMBERSHIP $50.00",
    "PARKING LOT $55.00",
    "RESTAURANT DINNER $80.00",
  ].join("\n");

  it("categorises transactions into the correct buckets", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions });
    const result = JSON.parse(raw);

    expect(result.categoryTotals.Housing).toBeCloseTo(1200);
    expect(result.categoryTotals.Food).toBeGreaterThan(0);      // starbucks, doordash, grocery, restaurant
    expect(result.categoryTotals.Transport).toBeGreaterThan(0); // uber, gas
    expect(result.categoryTotals.Entertainment).toBeGreaterThan(0); // netflix
    expect(result.categoryTotals.Subscriptions).toBeGreaterThan(0); // spotify
  });

  it("computes totalMonthlySpend as the sum of all categories", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions });
    const result = JSON.parse(raw);

    const sumOfCategories = Object.values(result.categoryTotals).reduce((a, b) => a + b, 0);
    expect(parseFloat(result.totalMonthlySpend)).toBeCloseTo(sumOfCategories, 1);
  });

  it("calculates savings rate correctly when salary is provided", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions, salary: 5000 });
    const result = JSON.parse(raw);

    const spend = parseFloat(result.totalMonthlySpend);
    const expectedRate = (((5000 - spend) / 5000) * 100).toFixed(1);
    expect(result.savingsRate).toBe(`${expectedRate}%`);
  });

  it("returns unknown savings rate when no salary provided", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions });
    const result = JSON.parse(raw);

    expect(result.savingsRate).toBe("unknown (no salary on file)");
  });

  it("flags anomalies when a transaction is more than 2x the category average and over $50", async () => {
    // Three food transactions: two small, one large.
    // avg = (10 + 12 + 800) / 3 = 274. $800 > 2*274 = 548 AND $800 > $50 → flagged.
    const anomalyTxns = [
      "GROCERY STORE $10.00",
      "STARBUCKS COFFEE $12.00",
      "RESTAURANT BLOWOUT $800.00",
    ].join("\n");
    const raw = await spendingAnalysisTool.invoke({ transactions: anomalyTxns });
    const result = JSON.parse(raw);

    expect(result.anomalies).not.toContain("None detected");
    expect(result.anomalies.some(a => a.includes("$800.00"))).toBe(true);
  });

  it("reports no anomalies when all transactions are uniform", async () => {
    const uniform = [
      "GROCERY STORE $50.00",
      "GROCERY STORE $50.00",
      "GROCERY STORE $50.00",
    ].join("\n");
    const raw = await spendingAnalysisTool.invoke({ transactions: uniform });
    const result = JSON.parse(raw);

    expect(result.anomalies).toEqual(["None detected"]);
  });

  it("returns chart data only for categories with spend > 0", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions });
    const result = JSON.parse(raw);

    const chartValues = Object.values(result.chartData);
    expect(chartValues.every(v => v > 0)).toBe(true);
  });

  it("returns top 3 categories sorted by spend descending", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions });
    const result = JSON.parse(raw);

    expect(result.top3Categories).toHaveLength(3);
    const amounts = result.top3Categories.map(s => parseFloat(s.split("$")[1]));
    expect(amounts[0]).toBeGreaterThanOrEqual(amounts[1]);
    expect(amounts[1]).toBeGreaterThanOrEqual(amounts[2]);
  });

  it("handles empty transactions gracefully", async () => {
    const raw = await spendingAnalysisTool.invoke({ transactions: "" });
    const result = JSON.parse(raw);

    expect(parseFloat(result.totalMonthlySpend)).toBe(0);
    expect(result.anomalies).toEqual(["None detected"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// syncProfileTool
// ─────────────────────────────────────────────────────────────────────────────
describe("syncProfileTool", () => {
  const emptyState = { profile: { salary: null, currentSavings: null, goals: null } };

  it("sets salary when provided", async () => {
    const raw = await syncProfileTool.invoke(
      { salary: 5000 },
      { configurable: { state: emptyState } }
    );
    const result = JSON.parse(raw);
    expect(result.newProfile.salary).toBe(5000);
  });

  it("sets goals when provided", async () => {
    const raw = await syncProfileTool.invoke(
      { goals: "save for a house" },
      { configurable: { state: emptyState } }
    );
    const result = JSON.parse(raw);
    expect(result.newProfile.goals).toBe("save for a house");
  });

  it("adds deposit to existing savings", async () => {
    const stateWithSavings = { profile: { salary: null, currentSavings: 1000, goals: null } };
    const raw = await syncProfileTool.invoke(
      { deposit: 500 },
      { configurable: { state: stateWithSavings } }
    );
    const result = JSON.parse(raw);
    expect(result.newProfile.currentSavings).toBe(1500);
  });

  it("sets exact savings amount when totalSavings is provided", async () => {
    const stateWithSavings = { profile: { salary: null, currentSavings: 1000, goals: null } };
    const raw = await syncProfileTool.invoke(
      { totalSavings: 8000 },
      { configurable: { state: stateWithSavings } }
    );
    const result = JSON.parse(raw);
    expect(result.newProfile.currentSavings).toBe(8000);
  });

  it("preserves existing fields when updating only one field", async () => {
    const existingState = { profile: { salary: 4000, currentSavings: 2000, goals: "retire early" } };
    const raw = await syncProfileTool.invoke(
      { salary: 5000 },
      { configurable: { state: existingState } }
    );
    const result = JSON.parse(raw);
    expect(result.newProfile.salary).toBe(5000);
    expect(result.newProfile.currentSavings).toBe(2000); // preserved
    expect(result.newProfile.goals).toBe("retire early"); // preserved
  });

  it("returns a status message", async () => {
    const raw = await syncProfileTool.invoke(
      { salary: 3000 },
      { configurable: { state: emptyState } }
    );
    const result = JSON.parse(raw);
    expect(result.status).toBe("Profile synchronized");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// wealthForecastTool
// ─────────────────────────────────────────────────────────────────────────────
describe("wealthForecastTool", () => {
  it("returns a string containing the projected balance", async () => {
    const result = await wealthForecastTool.invoke({
      currentSavings: 10000,
      monthlyContribution: 500,
      years: 10,
      interestRate: 5,
    });
    expect(typeof result).toBe("string");
    expect(result).toMatch(/Projected balance after 10 years/);
  });

  it("projects more wealth with a higher interest rate", async () => {
    const base = { currentSavings: 5000, monthlyContribution: 200, years: 5 };

    const low  = await wealthForecastTool.invoke({ ...base, interestRate: 2 });
    const high = await wealthForecastTool.invoke({ ...base, interestRate: 8 });

    const extractAmount = (s) => parseFloat(s.replace(/[^0-9.]/g, ""));
    expect(extractAmount(high)).toBeGreaterThan(extractAmount(low));
  });

  it("defaults interest rate to 5% when not provided", async () => {
    const withDefault = await wealthForecastTool.invoke({
      currentSavings: 1000,
      monthlyContribution: 100,
      years: 1,
    });
    const withExplicit = await wealthForecastTool.invoke({
      currentSavings: 1000,
      monthlyContribution: 100,
      years: 1,
      interestRate: 5,
    });
    expect(withDefault).toBe(withExplicit);
  });

  it("compounds monthly over the given number of years", async () => {
    // After 12 months at 1%/month: 12000 * (1.01^12) ≈ 13523
    const result = await wealthForecastTool.invoke({
      currentSavings: 12000,
      monthlyContribution: 0,
      years: 1,
      interestRate: 12, // 1% per month for easy mental math
    });
    // Extract the dollar amount — last "$X" in the string
    const match = result.match(/\$([\d,]+(\.\d+)?)$/);
    const amount = parseFloat(match[1].replace(/,/g, ""));
    expect(amount).toBeGreaterThan(13000);
    expect(amount).toBeLessThan(14000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractStatementTool
// ─────────────────────────────────────────────────────────────────────────────
describe("extractStatementTool", () => {
  it("returns the statement text from graph state", async () => {
    const config = { configurable: { state: { statementText: "RENT $1200\nSTARBUCKS $5" } } };
    const result = await extractStatementTool.invoke({}, config);
    expect(result).toBe("RENT $1200\nSTARBUCKS $5");
  });

  it("returns a 'no statement' message when state has no text", async () => {
    const config = { configurable: { state: { statementText: "" } } };
    const result = await extractStatementTool.invoke({}, config);
    expect(result).toBe("No bank statement has been uploaded in this session.");
  });

  it("returns a 'no statement' message when config is missing", async () => {
    const result = await extractStatementTool.invoke({});
    expect(result).toBe("No bank statement has been uploaded in this session.");
  });
});
