import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import {ChatOpenAI } from "@langchain/openai";
import {ChatGoogleGenerativeAI} from "@langchain/google-genai";
import { wealthForecastTool, syncProfileTool, spendingAnalysisTool, extractStatementTool } from "./tools.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ─────────────────────────────────────────────────────────────────────────────
// 1. MODEL FACTORY — reads LLM_PROVIDER from .env, picks the right model
//    Supported: "openai" | "google" (default)
//    Required env vars:
//      OPENAI_API_KEY   (when LLM_PROVIDER=openai)
//      GOOGLE_API_KEY   (when LLM_PROVIDER=google or unset)
// ─────────────────────────────────────────────────────────────────────────────
function createModel() {
  const provider = (process.env.LLM_PROVIDER || "google").toLowerCase();
  console.log(`[MODEL] Provider: ${provider}`);

  if (provider === "openai") {
    return new ChatOpenAI({
      model: "gpt-5-nano-2025-08-07",
      apiKey: process.env.OPENAI_API_KEY,
      temperature: 0,
    });
  }

  // Default: Google Gemini
  return new ChatGoogleGenerativeAI({
    model: "gemini-3.1-flash-lite-preview",
    apiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    temperature: 0,
  });
}

// Initialise model at startup (top-level await via async IIFE)
const model = createModel()

// Each subagent gets only the tools it needs (both always have sync_profile)
const spendingModel = model.bindTools([extractStatementTool, syncProfileTool, spendingAnalysisTool]);
const wealthModel   = model.bindTools([syncProfileTool, wealthForecastTool]);

// ─────────────────────────────────────────────────────────────────────────────
// PDF EXTRACTION  (server-side, no LLM involved)
// ─────────────────────────────────────────────────────────────────────────────
async function pdfParse(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return { text, numpages: doc.numPages };
}

// ─────────────────────────────────────────────────────────────────────────────
// PII PRESCRUB
// ─────────────────────────────────────────────────────────────────────────────
const PII_RULES = [
  { pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g,                                       label: "[SSN REDACTED]" },
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{1,4}\b/g,                                       label: (m) => `[CARD ...${m.replace(/\D/g,'').slice(-4)}]` },
  { pattern: /\bACCT?[:\s#]*(\d{5,})\b/gi,                                            label: (_, g1) => `ACCT [...${g1.slice(-4)}]` },
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,               label: "[EMAIL REDACTED]" },
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,                  label: "[PHONE REDACTED]" },
  { pattern: /\b(Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,             label: "[NAME REDACTED]" },
  { pattern: /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Terr?|Cir)\b\.?/gi, label: "[ADDRESS REDACTED]" },
  { pattern: /\b\d{5}(-\d{4})?\b/g,                                                  label: "[ZIP REDACTED]" },
  { pattern: /\b(DOB|Date of Birth)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi,      label: "[DOB REDACTED]" },
];

function prescrubText(text) {
  let s = text;
  for (const rule of PII_RULES) {
    s = typeof rule.label === "function"
      ? s.replace(rule.pattern, rule.label)
      : s.replace(rule.pattern, rule.label);
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS — base shared context + one prompt per subagent
// ─────────────────────────────────────────────────────────────────────────────
function detectMode(lastUserMessage) {
  const msg = lastUserMessage.toLowerCase();
  const forecastKeywords = ["forecast", "project", "future", "years", "retire", "compound", "invest", "growth", "worth in"];
  if (forecastKeywords.some(k => msg.includes(k))) return "forecast";
  return "spending";
}

function buildBasePrompt(profile, summary, missing) {
  return `
ROLE: Personal Finance AI
USER PROFILE: Monthly income $${profile.salary ?? "unknown"} | Savings $${profile.currentSavings ?? "unknown"} | Goal: ${profile.goals ?? "unknown"}
MEMORY: ${summary || "No prior history."}
MISSING DATA: ${missing.length > 0 ? missing.join(", ") : "none — full analysis enabled"}
PII NOTE: All PII has been pre-scrubbed. Account numbers show only last 4 digits.
`.trim();
}

function buildSpendingPrompt(base, missing) {
  return `${base}

MODE: SPENDING ANALYSIS SPECIALIST
You are an expert at reading bank statements and identifying waste.
You have access to 'sync_profile' and 'spending_analysis'.

INSTRUCTIONS:
1. Always call 'sync_profile' IMMEDIATELY with whatever profile data the user provides — even partial (e.g. a goal phrase like "save more" or "retire early" counts as a goals value). Do NOT ask for clarification before saving what you already have.
2. BANK STATEMENT RULE: When the user mentions uploading a statement:
   - Call 'extract_statement' to retrieve the raw text.
   - Then call 'spending_analysis' with those transaction lines and salary if known.
   - Use the tool's output (categoryTotals, anomalies, chartData) to build your response.
   - Present a Markdown table of spending by category.
   - Call out the top 3 categories and flag any anomalies the tool detected.
   - End with annual savings potential.
   - Append: [CHART_DATA: <chartData from tool result>]
3. DATA COLLECTION MODE: If still missing fields (${missing.join(", ")}), sync what you have, then ask for what's missing. Do NOT run full analysis yet.`.trim();
}

function buildWealthPrompt(base) {
  return `${base}

MODE: WEALTH FORECAST SPECIALIST
You are a wealth projection expert. Your job is to run forward-looking financial models.
You have access to the 'wealth_forecast' tool only.

INSTRUCTIONS:
1. ALWAYS call 'wealth_forecast' with realistic assumptions.
   - Use the user's current savings as currentSavings.
   - Estimate monthlyContribution as (salary - typical expenses). Ask if unsure.
   - Default interestRate to 5% (S&P average) unless user specifies.
2. After calling the tool, explain the result clearly: what the number means, assumptions made, and how to improve it.
3. Offer 2-3 actionable levers: "increase monthly contribution by $X to reach Y sooner."
4. If data is numeric and worth charting, append: [CHART_DATA: {"Year 5": amt, "Year 10": amt, ...}]`.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const FinancialState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  profile: Annotation({
    reducer: (current, update) => {
      if (!update || Object.keys(update).length === 0) return current;
      return {
        salary:         update.salary         ?? current.salary,
        goals:          update.goals          ?? current.goals,
        currentSavings: update.currentSavings ?? current.currentSavings,
      };
    },
    default: () => ({ salary: null, goals: null, currentSavings: null }),
  }),
  summary: Annotation({ reducer: (_, next) => next, default: () => "" }),
  isReadyForAnalysis: Annotation({ reducer: (_, next) => next, default: () => false }),
  statementText: Annotation({ reducer: (_, next) => next, default: () => "" }),
});

// ─────────────────────────────────────────────────────────────────────────────
// NODES
// ─────────────────────────────────────────────────────────────────────────────

/** Rolling summariser — only fires when conversation grows long */
const summarizerNode = async (state) => {
  if (state.messages.length < 8) return {};
  const response = await model.invoke([
    { role: "system", content: `Distill this conversation into a concise summary. Incorporate existing summary: "${state.summary}". Focus on financial facts, numbers, and goals.` },
    ...state.messages,
  ]);
  return { summary: response.content, messages: state.messages.slice(-2) };
};

/**
 * 4. GATEKEEPER — pure deterministic logic, no LLM calls.
 *    - Returns static messages for missing-profile cases.
 *    - Only sets isReadyForAnalysis=true when profile is complete OR user is actively providing data.
 */
const gatekeeperNode = (state) => {
  const p = state.profile;
  const lastContent = state.messages[state.messages.length - 1]?.content ?? "";
  const lastMsg = typeof lastContent === "string" ? lastContent.toLowerCase() : "";

  const missing = [];
  if (!p.salary)        missing.push("monthly income");
  if (!p.goals)         missing.push("financial goals");
  if (!p.currentSavings) missing.push("current savings");

  // User is actively typing data — let the analyzer handle it (it will call sync_profile)
  const userIsProvidingData =
    lastMsg.includes("salary") ||
    lastMsg.includes("income") ||
    lastMsg.includes("earn") ||
    lastMsg.includes("save") ||       // "save 10K" and "saving"
    lastMsg.includes("goal") ||
    lastMsg.includes("retire") ||
    lastMsg.includes("want to") ||
    lastMsg.includes("statement") ||  // PDF upload injection
    lastMsg.includes("transaction") ||
    /\$?\d{3,}/.test(lastMsg) ||      // dollar amount with digits: $5000
    /\d+\s*[kK]\b/.test(lastMsg);    // K-format: 10K, 5k

  // Nothing known yet and user hasn't said anything useful — return static welcome
  if (missing.length === 3 && !userIsProvidingData) {
    return {
      messages: [{
        role: "assistant",
        content: "👋 I'm your Personal Finance Analyst. To get started, I need three things:\n\n1. **Monthly income** — your take-home salary\n2. **Current savings** — your total saved so far\n3. **Financial goal** — e.g. \"save $20k for a house\" or \"retire early\"\n\nYou can type these or upload a bank statement PDF using the 📎 button.",
      }],
      isReadyForAnalysis: false,
    };
  }

  // Profile partially complete and user isn't providing anything new — nudge for the rest
  if (missing.length > 0 && !userIsProvidingData) {
    const missingStr = missing.map(f => `**${f}**`).join(", ");
    return {
      messages: [{
        role: "assistant",
        content: `Almost there! I still need your ${missingStr} to unlock full analysis. What are those values?`,
      }],
      isReadyForAnalysis: false,
    };
  }

  // Profile complete — check if we need to show the "ready" confirmation
  if (missing.length === 0) {
    const alreadyVerified = state.messages.some(
      m => typeof m.content === "string" && m.content.includes("Profile complete")
    );
    if (!alreadyVerified) {
      return {
        messages: [{
          role: "assistant",
          content: "✅ **Profile complete.** Share your transactions or ask anything — I'll analyse your spending, or run a wealth forecast if you'd like to see your money grow.",
        }],
        isReadyForAnalysis: true,
      };
    }
  }

  // Default: proceed to analyzer
  return { isReadyForAnalysis: true };
};

function getMissingFields(profile) {
  const missing = [];
  if (!profile.salary)         missing.push("monthly income");
  if (!profile.goals)          missing.push("financial goals");
  if (!profile.currentSavings) missing.push("current savings");
  return missing;
}

/** Spending subagent — only has access to sync_profile */
const spendingAgentNode = async (state) => {
  const missing = getMissingFields(state.profile);
  const base = buildBasePrompt(state.profile, state.summary, missing);
  const systemPrompt = buildSpendingPrompt(base, missing);
  console.log("[AGENT] spending");
  const response = await spendingModel.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response] };
};

/** Wealth subagent — only has access to wealth_forecast */
const wealthAgentNode = async (state) => {
  const missing = getMissingFields(state.profile);
  const base = buildBasePrompt(state.profile, state.summary, missing);
  const systemPrompt = buildWealthPrompt(base);
  console.log("[AGENT] wealth");
  const response = await wealthModel.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response] };
};

/** Shared helper: execute sync_profile and return { output, profileUpdate } */
async function runSyncProfile(toolCall, state, currentProfileUpdate) {
  const freshState = { ...state, profile: currentProfileUpdate ?? state.profile };
  const raw = await syncProfileTool.invoke(toolCall.args, { configurable: { state: freshState } });
  const parsed = JSON.parse(raw);
  return { output: parsed.status, profileUpdate: parsed.newProfile };
}

/** Tool executor for spending subagent (sync_profile + spending_analysis) */
const spendingToolNode = async (state) => {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolOutputs = [];
  let profileUpdate = null;

  for (const toolCall of lastMessage.tool_calls) {
    let output;
    if (toolCall.name === "sync_profile") {
      const r = await runSyncProfile(toolCall, state, profileUpdate);
      profileUpdate = r.profileUpdate;
      output = r.output;
    } else if (toolCall.name === "extract_statement") {
      output = await extractStatementTool.invoke(toolCall.args, { configurable: { state } });
    } else if (toolCall.name === "spending_analysis") {
      output = await spendingAnalysisTool.invoke(toolCall.args);
    }
    toolOutputs.push({ role: "tool", content: output, tool_call_id: toolCall.id });
  }

  const stateUpdate = { messages: toolOutputs };
  if (profileUpdate !== null) stateUpdate.profile = profileUpdate;
  return stateUpdate;
};

/** Tool executor for wealth subagent (sync_profile + wealth_forecast) */
const wealthToolNode = async (state) => {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolOutputs = [];
  let profileUpdate = null;

  for (const toolCall of lastMessage.tool_calls) {
    let output;
    if (toolCall.name === "sync_profile") {
      const r = await runSyncProfile(toolCall, state, profileUpdate);
      profileUpdate = r.profileUpdate;
      output = r.output;
    } else if (toolCall.name === "wealth_forecast") {
      output = await wealthForecastTool.invoke(toolCall.args);
    }
    toolOutputs.push({ role: "tool", content: output, tool_call_id: toolCall.id });
  }

  const stateUpdate = { messages: toolOutputs };
  if (profileUpdate !== null) stateUpdate.profile = profileUpdate;
  return stateUpdate;
};

// ─────────────────────────────────────────────────────────────────────────────
// GRAPH
// ─────────────────────────────────────────────────────────────────────────────
const hasToolCalls = (s) => s.messages[s.messages.length - 1].tool_calls?.length > 0;

const workflow = new StateGraph(FinancialState)
  .addNode("summarizer",    summarizerNode)
  .addNode("gatekeeper",    gatekeeperNode)
  .addNode("spendingAgent", spendingAgentNode)
  .addNode("wealthAgent",   wealthAgentNode)
  .addNode("spendingTools", spendingToolNode)
  .addNode("wealthTools",   wealthToolNode)
  .addEdge(START, "summarizer")
  .addEdge("summarizer", "gatekeeper")
  .addConditionalEdges("gatekeeper", (s) => {
    if (!s.isReadyForAnalysis) return END;
    const lastUserMsg = [...s.messages].reverse().find(m => m.role === "user")?.content ?? "";
    return detectMode(typeof lastUserMsg === "string" ? lastUserMsg : "") === "forecast"
      ? "wealthAgent"
      : "spendingAgent";
  })
  .addConditionalEdges("spendingAgent", (s) => hasToolCalls(s) ? "spendingTools" : END)
  .addEdge("spendingTools", "spendingAgent")
  .addConditionalEdges("wealthAgent", (s) => hasToolCalls(s) ? "wealthTools" : END)
  .addEdge("wealthTools", "wealthAgent");

const graph = workflow.compile({ checkpointer: new MemorySaver() });

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { messages, threadId } = req.body;
  const config = { configurable: { thread_id: threadId ?? "default" } };

  try {
    const result = await graph.invoke({ messages: [messages[messages.length - 1]] }, config);
    const last = result.messages[result.messages.length - 1];
    const text = typeof last.content === "string" ? last.content : "I've processed your request.";
    const currentState = await graph.getState(config);
    res.json({ text, profile: currentState.values.profile });
  } catch (err) {
    console.error("[/api/chat error]", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-pdf', async (req, res) => {
  const { base64Pdf, filename, threadId } = req.body;
  const config = { configurable: { thread_id: threadId ?? "default" } };

  if (!base64Pdf) return res.status(400).json({ error: "No PDF data provided" });

  // Validate
  const bufferCheck = Buffer.from(base64Pdf.slice(0, 20), "base64").toString("ascii");
  if (!bufferCheck.startsWith("%PDF")) {
    return res.status(400).json({ error: "Invalid PDF: does not start with %PDF header." });
  }

  // Extract
  let extractedText = "";
  try {
    const buffer = Buffer.from(base64Pdf, "base64");
    const parsed = await pdfParse(buffer);
    extractedText = parsed.text || "";
    console.log(`[PDF] ${parsed.numpages} pages, ${extractedText.length} chars from "${filename}"`);
  } catch (err) {
    console.error("[PDF Extraction Error]", err.message);
    return res.status(422).json({ error: "Could not read PDF. Ensure it is text-based, not a scanned image.", detail: err.message });
  }

  if (!extractedText.trim()) {
    return res.status(422).json({ error: "PDF appears empty or image-only." });
  }

  // Prescrub + trim
  const scrubbed = prescrubText(extractedText);
  const trimmed = scrubbed.length > 6000 ? scrubbed.slice(0, 6000) + "\n... [truncated]" : scrubbed;

  const uploadMessage = {
    role: "user",
    content: `I've uploaded my bank statement (${prescrubText(filename || "statement.pdf")}). Please call extract_statement to read it, then analyse my spending.`,
  };

  try {
    const result = await graph.invoke({ messages: [uploadMessage], statementText: trimmed }, config);
    const last = result.messages[result.messages.length - 1];
    const text = typeof last.content === "string" ? last.content : "Bank statement analysed.";
    const currentState = await graph.getState(config);
    res.json({ text, profile: currentState.values.profile });
  } catch (err) {
    console.error("[PDF Graph Error]", err);
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

app.listen(3001, () => console.log(`[SRE-CORE] Online · provider: ${process.env.LLM_PROVIDER || "google"}`));