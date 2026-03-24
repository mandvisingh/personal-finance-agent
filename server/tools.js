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
    const CATEGORIES = ["Housing", "Food", "Transport", "Entertainment", "Subscriptions", "Other"];

    // Parse transaction lines into { description, amount }
    const lines = transactions.split("\n").map(l => l.trim()).filter(Boolean);
    const parsed = lines.map(line => {
      const amtMatch = line.match(/[-+]?\$?([\d,]+(\.\d{2})?)/);
      const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, "")) : 0;
      return { description: line, amount };
    }).filter(t => t.amount > 0);

    // Keyword-based categoriser
    const RULES = [
      { category: "Housing",       keywords: ["rent", "mortgage", "hoa", "insurance", "utilities", "electric", "gas", "water", "internet", "cable"] },
      { category: "Food",          keywords: ["grocery", "groc", "supermarket", "whole foods", "trader joe", "safeway", "restaurant", "cafe", "coffee", "doordash", "ubereats", "grubhub", "chipotle", "mcdonald", "starbucks"] },
      { category: "Transport",     keywords: ["uber", "lyft", "taxi", "gas station", "fuel", "parking", "toll", "transit", "metro", "subway", "train", "airline", "flight"] },
      { category: "Entertainment", keywords: ["netflix", "hulu", "disney", "spotify", "apple music", "cinema", "theater", "concert", "amazon prime", "youtube", "gaming", "steam"] },
      { category: "Subscriptions", keywords: ["subscription", "monthly fee", "annual fee", "membership", "gym", "fitness", "adobe", "microsoft", "google one", "icloud", "dropbox"] },
    ];

    function categorise(description) {
      const lower = description.toLowerCase();
      for (const rule of RULES) {
        if (rule.keywords.some(k => lower.includes(k))) return rule.category;
      }
      return "Other";
    }

    // Group by category
    const totals = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
    const byCategory = Object.fromEntries(CATEGORIES.map(c => [c, []]));
    for (const t of parsed) {
      const cat = categorise(t.description);
      totals[cat] += t.amount;
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
    description: "Categorises raw transaction text into spending buckets, flags anomalies, calculates savings rate, and returns chart-ready data. Call this whenever the user provides bank statement transactions.",
    schema: z.object({
      transactions: z.string().describe("Raw transaction lines from the bank statement, one per line"),
      salary:         z.number().optional().describe("Monthly take-home salary for savings rate calculation"),
      goals:          z.string().optional().describe("User's financial goal"),
      currentSavings: z.number().optional().describe("Current savings balance"),
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

/**
 * Extracts and structures transaction data from a base64-encoded bank statement PDF.
 * Returns cleaned text lines that look like financial transactions.
 */
// export const extractFromPdfTool = tool(
//   async ({ base64Pdf }) => {
//     try {
//       const buffer = Buffer.from(base64Pdf, "base64");
//       const parsed = await pdfParse(buffer);
//       const rawText = parsed.text;

//       if (!rawText || rawText.trim().length === 0) {
//         return JSON.stringify({ error: "No extractable text found in PDF. It may be a scanned image." });
//       }

//       // Split into lines and filter to likely transaction lines:
//       // - contain a date pattern (MM/DD or DD/MM or YYYY-MM-DD)
//       // - contain a dollar amount pattern
//       const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);

//       const datePattern = /\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?/;
//       const amountPattern = /\$?\d{1,3}(,\d{3})*(\.\d{2})?/;

//       const transactionLines = lines.filter(line => 
//         datePattern.test(line) && amountPattern.test(line)
//       );

//       // Fall back to all non-header lines if no transaction lines detected
//       const outputLines = transactionLines.length > 5 ? transactionLines : lines.slice(0, 200);

//       return JSON.stringify({
//         status: "PDF extracted successfully",
//         pageCount: parsed.numpages,
//         transactionCount: transactionLines.length,
//         transactions: outputLines.join("\n"),
//       });
//     } catch (err) {
//       return JSON.stringify({ error: `PDF extraction failed: ${err.message}` });
//     }
//   },
//   {
//     name: "extract_from_pdf",
//     description: "Extracts transaction data from a base64-encoded bank statement PDF. Call this when the user uploads a PDF.",
//     schema: z.object({
//       base64Pdf: z.string().describe("Base64-encoded PDF content"),
//     }),
//   }
// );