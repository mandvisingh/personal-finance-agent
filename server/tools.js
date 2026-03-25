import { tool } from "@langchain/core/tools";
import { z } from "zod";
// import { createRequire } from "module";
// const require = createRequire(import.meta.url);
// const pdfParse = require("pdf-parse");

export const extractStatementTool = tool(
  async (_args, config) => {
    const text = config?.configurable?.state?.statementText;
    if (!text) return "No bank statement has been uploaded in this session.";
    return text;
  },
  {
    name: "extract_statement",
    description: "Returns the full text of the bank statement the user uploaded this session. Call this first before running spending_analysis.",
    schema: z.object({}),
  }
);

export const syncProfileTool = tool(
  async ({ salary, deposit, totalSavings, goals }, config) => {
    const currentState = config?.configurable?.state?.profile || {};
 
    const updatedSavings = totalSavings !== undefined 
      ? totalSavings 
      : (currentState.currentSavings || 0) + (deposit || 0);
 
    // Use nullish coalescing but treat null as "no value" — only update a field
    // if the tool was explicitly called with it. Otherwise preserve the existing value.
    const newProfile = {
      salary:         (salary        != null) ? salary        : (currentState.salary        ?? null),
      goals:          (goals         != null) ? goals         : (currentState.goals         ?? null),
      currentSavings: updatedSavings,
    };
 
    return JSON.stringify({
      status: "Profile synchronized",
      newProfile: newProfile
    });
  },
  {
    name: "sync_profile",
    description: "Updates the user's financial profile. Use 'deposit' to add to savings or 'totalSavings' to set an exact amount.",
    schema: z.object({
      salary: z.number().optional(),
      deposit: z.number().optional(),
      totalSavings: z.number().optional(),
      goals: z.string().optional(),
    }),
  }
);

export const spendingAnalysisTool = tool(
  async ({ transactions, salary }) => {
    // Group pre-categorised transactions — categories are defined by the LLM
    const totals = {};
    const byCategory = {};
    for (const t of transactions) {
      const cat = t.category || "Other";
      totals[cat] = (totals[cat] || 0) + t.amount;
      byCategory[cat] = byCategory[cat] || [];
      byCategory[cat].push(t.amount);
    }

    // Flag anomalies: transactions > 2× category average
    const anomalies = [];
    for (const [cat, amounts] of Object.entries(byCategory)) {
      if (amounts.length === 0) continue;
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      for (const amt of amounts) {
        if (amt > avg * 2 && amt > 50) anomalies.push({ category: cat, amount: amt, avg: avg.toFixed(2) });
      }
    }

    const totalSpend = Object.values(totals).reduce((a, b) => a + b, 0);
    const monthlySalary = salary ?? 0;
    const savingsRate = monthlySalary > 0
      ? (((monthlySalary - totalSpend) / monthlySalary) * 100).toFixed(1)
      : null;

    // Top 3 categories by spend
    const ranked = Object.entries(totals)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([cat, amt]) => `${cat}: $${amt.toFixed(2)}`);

    return JSON.stringify({
      categoryTotals: totals,
      totalMonthlySpend: totalSpend.toFixed(2),
      savingsRate: savingsRate ? `${savingsRate}%` : "unknown (no salary on file)",
      top3Categories: ranked,
      anomalies: anomalies.length > 0
        ? anomalies.map(a => `${a.category} — $${a.amount.toFixed(2)} (avg $${a.avg})`)
        : ["None detected"],
      annualSavingsPotential: monthlySalary > 0
        ? `$${((monthlySalary - totalSpend) * 12).toFixed(2)}`
        : "unknown",
      chartData: Object.fromEntries(Object.entries(totals).filter(([, v]) => v > 0)),
    });
  },
  {
    name: "spending_analysis",
    description: "Calculates spending totals, savings rate, anomalies, and chart data from pre-categorised transactions. YOU must categorise each transaction using your world knowledge before calling this tool.",
    schema: z.object({
      transactions: z.array(z.object({
        description: z.string(),
        amount: z.number(),
        category: z.string().describe("Category you choose based on the merchant — e.g. Food, Transport, Housing, Health, Entertainment, Subscriptions"),
      })).describe("Transactions with categories assigned by you using your world knowledge of merchants"),
      salary: z.number().optional().describe("Monthly take-home salary for savings rate calculation"),
    }),
  }
);

export const wealthForecastTool = tool(
  async ({ currentSavings, monthlyContribution, years, interestRate }) => {
    const rate = (interestRate || 5) / 100 / 12;
    const months = years * 12;
    let total = currentSavings;
    for (let i = 0; i < months; i++) {
      total = (total + monthlyContribution) * (1 + rate);
    }
    return `Projected balance after ${years} years: $${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  },
  {
    name: "wealth_forecast",
    description: "Calculate future wealth based on compound interest.",
    schema: z.object({
      currentSavings: z.number(),
      monthlyContribution: z.number(),
      years: z.number(),
      interestRate: z.number().optional(),
    }),
  }
);