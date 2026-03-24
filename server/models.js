import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { wealthForecastTool, syncProfileTool, spendingAnalysisTool, extractStatementTool } from "./tools.js";
import { createLogger } from "./logger.js";

const log = createLogger("model");

function createModel() {
  const provider = (process.env.LLM_PROVIDER || "google").toLowerCase();
  log.info(`Provider: ${provider}`);

  if (provider === "openai") {
    return new ChatOpenAI({
      model: "gpt-4.1",
      apiKey: process.env.OPENAI_API_KEY,
      temperature: 0,
    });
  }

  return new ChatGoogleGenerativeAI({
    model: "gemini-3.1-flash-lite-preview",
    apiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    temperature: 0,
  });
}

export const model = createModel();

// Each subagent only sees the tools it needs — prevents cross-contamination
export const spendingModel = model.bindTools([extractStatementTool, syncProfileTool, spendingAnalysisTool]);
export const wealthModel   = model.bindTools([syncProfileTool, wealthForecastTool]);
