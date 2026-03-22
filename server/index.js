import express from 'express';
import cors from 'cors';
import 'dotenv/config';
// import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import { generateText, tool } from 'ai';
import { z } from 'zod';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// tools
const tools = {

  // Tool 1: Get Bank Statement (Simulating CSV/JSON layer)
  get_bank_statement: tool({
    description: 'REQUIRED to see any past transactions, spending, or salary for a specific month.',
    parameters: z.object({
      month: z.string().describe('The month to fetch (e.g., "January 2024")'),
    }),
    execute: async ({ month }) => {
      // This mimics your Fetch --> CSV logic in the diagram
      const mockStatements = {
        "January 2024": [
          { date: "2024-01-05", desc: "Mortgage Payment", amount: -2500 },
          { date: "2024-01-15", desc: "Wealthsimple Transfer", amount: -500 },
          { date: "2024-01-30", desc: "Salary", amount: 5000 }
        ]
      };
      return { transactions: mockStatements[month] || "No data for this period." };
    },
  }),

  // Tool 2: Get Financial Goals
  get_financial_goals: tool({
    description: 'REQUIRED to see the users target emergency fund and savings goals.',
    parameters: z.object({}),
    execute: async () => {
      return { 
        targets: { 
          emergencyFund: "$20,000", 
          mortgagePaydownExtra: "$500/mo",
          currentStatus: "On Track" 
        } 
      };
    },
  }),
};


function preScrub(text) {
  // Regex for common account numbers, emails, etc.
  return text
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, "[CARD-REDACTED]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN-REDACTED]")
    .replace(/\b\d{10,12}\b/g, "[ACCOUNT-REDACTED]");
}

// The Chat Route
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  // 1. SECURE STEP: Scrub the latest user message before it hits the LLM
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role === 'user') {
    lastMsg.content = preScrub(lastMsg.content);
  }

  try {
    const result = await generateText({
    //   model: openai('gpt-4o'),
      model: google('gemini-2.5-flash'),
      system: `Call the get_bank_statement tool for January 2024 and tell me the total amount of my transactions.`,
      messages,
      tools,
      maxSteps: 5,
    });
    console.log('[STEPS TAKEN]:', result.steps.length);
  
  const finalResponse = result.text || "I've processed the data but have no summary. Try asking specifically about your goals.";

  res.json({ text: finalResponse });

  } catch (error) {
    console.error('[ERROR]', error);
    res.status(500).json({ error: "Inference failed." });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`[SERVER] Logic-core online at port ${PORT}`));