import { tool } from "@langchain/core/tools";
import { z } from "zod";
// import { createRequire } from "module";
// const require = createRequire(import.meta.url);
// const pdfParse = require("pdf-parse");

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