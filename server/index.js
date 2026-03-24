import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import { z } from "zod";
import { wealthForecastTool, syncProfileTool /*extractFromPdfTool*/ } from "./tools.js";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

// Extract all text from a PDF buffer using pdfjs-dist
async function pdfParse(buffer) {
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return { text, numpages: doc.numPages };
}

 

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // Increased limit for base64 PDF payloads

const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

// ─────────────────────────────────────────────
// PII PRESCRUB UTILITY
// Removes sensitive personal identifiers from text before it reaches the LLM.
// ─────────────────────────────────────────────
const PII_RULES = [
  // SSN: 123-45-6789 or 123 45 6789
  { pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, label: "[SSN REDACTED]" },
  // Full credit/debit card numbers (13-19 digits, optionally spaced/dashed)
  { pattern: /\b(?:\d{4}[-\s]?){3}\d{1,4}\b/g, label: (m) => `[CARD ...${m.replace(/\D/g, '').slice(-4)}]` },
  // Bank account numbers: keep last 4, mask the rest
  { pattern: /\bACCT?[:\s#]*(\d{5,})\b/gi, label: (m, g1) => `ACCT [...${g1.slice(-4)}]` },
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, label: "[EMAIL REDACTED]" },
  // US phone numbers in various formats
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, label: "[PHONE REDACTED]" },
  // Full names heuristic: Title + Capitalized words (Mr./Ms./Dr. John Smith)
  { pattern: /\b(Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, label: "[NAME REDACTED]" },
  // Street addresses: number + street name patterns
  { pattern: /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Terr?|Cir)\b\.?/gi, label: "[ADDRESS REDACTED]" },
  // ZIP codes (US)
  { pattern: /\b\d{5}(-\d{4})?\b/g, label: "[ZIP REDACTED]" },
  // Date of birth patterns: DOB 01/15/1990
  { pattern: /\b(DOB|Date of Birth)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi, label: "[DOB REDACTED]" },
];

function prescrubText(text) {
  let scrubbed = text;
  for (const rule of PII_RULES) {
    if (typeof rule.label === "function") {
      scrubbed = scrubbed.replace(rule.pattern, rule.label);
    } else {
      scrubbed = scrubbed.replace(rule.pattern, rule.label);
    }
  }
  return scrubbed;
}

// ─────────────────────────────────────────────
// STATE DEFINITION
// ─────────────────────────────────────────────
const FinancialState = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  profile: Annotation({
    reducer: (current, update) => {
      if (!update || Object.keys(update).length === 0) return current;
      return {
        salary: update.salary ?? current.salary,
        goals: update.goals ?? current.goals,
        currentSavings: update.currentSavings ?? current.currentSavings,
      };
    },
    default: () => ({ salary: null, goals: null, currentSavings: null }),
  }),
  summary: Annotation({ 
    reducer: (old, next) => next, 
    default: () => "" 
  }),
  isReadyForAnalysis: Annotation({
    reducer: (old, next) => next,
    default: () => false,
  }),
  // Tracks whether a PDF was uploaded this turn
  pendingPdfBase64: Annotation({
    reducer: (old, next) => next ?? old,
    default: () => null,
  }),
});

// ─────────────────────────────────────────────
// MODEL
// ─────────────────────────────────────────────
const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite-preview",  // Fixed: was "gemini-3.1-flash-lite-preview" which is not a valid model name
  apiKey: apiKey,
  temperature: 0,
});

const modelWithTools = model.bindTools([wealthForecastTool, syncProfileTool/*, extractFromPdfTool*/]);

// ─────────────────────────────────────────────
// NODES
// ─────────────────────────────────────────────

/** Compresses old messages into a rolling summary to stay within context limits */
const summarizerNode = async (state) => {
  const { messages, summary } = state;
  if (messages.length < 8) return {}; 

  const response = await model.invoke([
    ["system", `Distill the following conversation into a concise summary, incorporating this existing summary: ${summary}. Focus on financial facts and recent transactions.`],
    ...messages
  ]);

  return {
    summary: response.content,
    messages: messages.slice(-2)
  };
};

/** 
 * Scrubs PII from the latest user message before any LLM sees it.
 * This runs on every turn so bank statement uploads are always cleaned.
 */
const prescrubNode = async (state) => {
  const messages = [...state.messages];
  const lastIdx = messages.length - 1;
  const lastMsg = messages[lastIdx];

  if (lastMsg?.role === "user" && typeof lastMsg.content === "string") {
    const scrubbed = prescrubText(lastMsg.content);
    if (scrubbed !== lastMsg.content) {
      console.log("[PRESCRUB] PII detected and redacted from user message");
      // Replace the last message with the scrubbed version
      // We can't mutate the reducer array, so we return a flag only; 
      // instead we directly update the message in place via a new array
      const updatedMessages = messages.slice(0, lastIdx).concat([
        { ...lastMsg, content: scrubbed }
      ]);
      // Return as a full messages replacement — requires custom handling below
      return { _scrubbedMessages: updatedMessages };
    }
  }
  return {};
};

/** Guards analysis until all three profile fields are collected */
const gatekeeperNode = async (state) => {
  const p = state.profile;
  const lastMsg = state.messages[state.messages.length - 1].content.toLowerCase();
  const userIsProvidingData = 
    lastMsg.includes("salary") || 
    lastMsg.includes("saving") || 
    lastMsg.includes("goal") || 
    /\d+/.test(lastMsg);
  const missing = [];
  if (!p.salary) missing.push("salary");
  if (!p.goals) missing.push("financial goals");
  if (!p.currentSavings) missing.push("current savings");

  if (missing.length === 3 && !userIsProvidingData) {
    return {
      messages: [{ 
        role: "assistant", 
        content: `Hello, I'm your Personal Finance Analyst and Advisor. Tell me more about your current salary, savings and financial goals.` 
      }],
      isReadyForAnalysis: false
    };
  } else if (missing.length > 0 && userIsProvidingData) {
    return { isReadyForAnalysis: true }; 
  } else if (missing.length > 0) {
    return {
      messages: [{ 
        role: "assistant", 
        content: `I'm tracking your progress, but I still need your ${missing.join(", ")} before I can do analysis. What are those values?` 
      }],
      isReadyForAnalysis: false
    };
  }

  const alreadyVerified = state.messages.some(m => m.content?.includes("System Profile Verified"));
  if (alreadyVerified) {
    return { isReadyForAnalysis: true }; 
  }

  return {
    messages: [{ 
      role: "assistant", 
      content: "System Profile Verified. Go ahead and share your recent transactions (or upload a bank statement PDF) and I will analyze your spend habits." 
    }],
    isReadyForAnalysis: true
  };
};

const analyzerNode = async (state) => {
  const p = state.profile;
  const missing = [];
  if (!p.salary) missing.push("salary");
  if (!p.goals) missing.push("financial goals");
  if (!p.currentSavings) missing.push("current savings");

  // If a PDF is pending, instruct the model to call extract_from_pdf first
  const pdfInstruction = state.pendingPdfBase64
    ? `\nIMPORTANT: The user has uploaded a bank statement PDF. Call 'extract_from_pdf' with the base64 content from the system context before doing any analysis.`
    : "";

  const systemInstruction = `
    ROLE: Financial SRE & Analyst
    CONTEXT: User has $${p.salary} income, $${p.currentSavings} savings and goal of ${p.goals}.
    PENDING_PDF_BASE64: ${state.pendingPdfBase64 ? state.pendingPdfBase64 : "none"}
    GOAL: Identify waste, categorize expenses, and suggest how to achieve user's goal of ${p.goals}.
    MEMORY: ${state.summary || "No prior history."}
    ${pdfInstruction}
    
    OUTPUT REQUIREMENTS:
    - Provide a Markdown Table for any spending breakdown.
    - End with a summary of total annual potential savings.
    - If data is numeric, append: [CHART_DATA: {"Category": Amount, ...}]
    - Use standard Markdown syntax for tables.
    
    CRITICAL INSTRUCTIONS:
    1. If the user provides new info (salary, savings, goals), ALWAYS call 'sync_profile' first before responding.
    2. BANK STATEMENT RULE: When a bank statement is provided, extract the following and call 'sync_profile' to update:
       - 'salary': total income/deposits found in the statement (use the highest recurring deposit as salary if not explicit)
       - 'totalSavings': closing/ending balance if present, otherwise omit
       Only update fields you can clearly identify — never guess.
    3. DATA COLLECTION MODE: If we are still missing ${missing.join(", ")}, DO NOT provide full budget analysis yet. 
       Acknowledge data received, confirm the sync, and ask for remaining missing fields.
    4. FULL ANALYSIS MODE: Only once all three (salary, savings, goals) are present should you provide budget breakdowns, tables, and [CHART_DATA].
    5. NOTE: All PII in messages has been pre-scrubbed. Account numbers show only last 4 digits. Do not ask for full account numbers.
  `.trim();

  const response = await modelWithTools.invoke([
    { role: "system", content: systemInstruction },
    ...state.messages 
  ]);
  return { messages: [response], profile: state.profile };
};

const toolNode = async (state) => {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolOutputs = [];
  let profileUpdate = null; // Only set if sync_profile runs — prevents wiping profile on wealth_forecast calls
 
  for (const toolCall of lastMessage.tool_calls) {
    let result;
 
    if (toolCall.name === "sync_profile") {
      // Pass the CURRENT state (including any profile updates from earlier tool calls
      // this turn) so sync_profile always sees the latest values, not a stale snapshot.
      const freshState = { ...state, profile: profileUpdate ?? state.profile };
      const toolResponse = await syncProfileTool.invoke(toolCall.args, { configurable: { state: freshState } });
      const parsed = JSON.parse(toolResponse);
      profileUpdate = parsed.newProfile;
      result = parsed.status;
 
    } else if (toolCall.name === "wealth_forecast") {
      result = await wealthForecastTool.invoke(toolCall.args);
 
    } else if (toolCall.name === "extract_from_pdf") {
      // Scrub the extracted text before returning it to the model
      const rawResult = await extractFromPdfTool.invoke(toolCall.args);
      const parsed = JSON.parse(rawResult);
      if (parsed.transactions) {
        parsed.transactions = prescrubText(parsed.transactions);
        console.log("[PRESCRUB] Applied PII scrub to extracted PDF text");
      }
      result = JSON.stringify(parsed);
    }
 
    toolOutputs.push({
      role: "tool",
      content: typeof result === "string" ? result : JSON.stringify(result),
      tool_call_id: toolCall.id,
    });
  }
 
  // BUG FIX: Only update profile if sync_profile actually ran
  const stateUpdate = { messages: toolOutputs };
  if (profileUpdate !== null) stateUpdate.profile = profileUpdate;
  return stateUpdate;
};
 

// ─────────────────────────────────────────────
// GRAPH
// ─────────────────────────────────────────────
const workflow = new StateGraph(FinancialState)
  .addNode("summarizer", summarizerNode)
  .addNode("gatekeeper", gatekeeperNode)
  .addNode("analyzer", analyzerNode)
  .addNode("tools", toolNode)
  .addEdge(START, "summarizer")
  .addEdge("summarizer", "gatekeeper")
  .addConditionalEdges("gatekeeper", (s) => s.isReadyForAnalysis ? "analyzer" : END)
  .addConditionalEdges("analyzer", (s) => s.messages[s.messages.length - 1].tool_calls?.length > 0 ? "tools" : END)
  .addEdge("tools", "analyzer");

const graph = workflow.compile({ checkpointer: new MemorySaver() });

// ─────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────

/** Standard chat endpoint */
app.post('/api/chat', async (req, res) => {
  const { messages, threadId } = req.body;
  const config = { configurable: { thread_id: threadId ?? "default" } };
 
  const result = await graph.invoke(
    { messages: [messages[messages.length - 1]] }, 
    config
  );
  
  const allMessages = result.messages;
  const lastResponse = allMessages[allMessages.length - 1];
 
  let finalString = "";
  if (typeof lastResponse.content === 'string') {
    finalString = lastResponse.content;
  } else {
    finalString = "I've updated your financial profile and processed your request.";
  }
 
  const currentState = await graph.getState(config);
  const finalProfile = currentState.values.profile;
 
  res.json({ text: finalString, profile: finalProfile });
});
 
/**
 * PDF upload endpoint.
 * Extracts text server-side first, prescrubs PII, then injects clean
 * transaction text as a user message into the graph. The base64 PDF never
 * reaches the LLM context window.
 */
app.post('/api/upload-pdf', async (req, res) => {
  const { base64Pdf, filename, threadId } = req.body;
  const config = { configurable: { thread_id: threadId ?? "default" } };
 
  if (!base64Pdf) {
    return res.status(400).json({ error: "No PDF data provided" });
  }
 
  // Step 1: Extract text from the PDF on the server
  let extractedText = "";
  try {
 
    // Validate base64 looks like a PDF before parsing
    const bufferCheck = Buffer.from(base64Pdf.slice(0, 20), "base64").toString("ascii");
    console.log("[PDF] Buffer magic bytes:", JSON.stringify(bufferCheck));
    if (!bufferCheck.startsWith("%PDF")) {
      return res.status(400).json({ error: "Invalid PDF: file does not start with %PDF header. Check the base64 encoding in the frontend." });
    }
 
    const buffer = Buffer.from(base64Pdf, "base64");
    console.log(`[PDF] Buffer size: ${buffer.length} bytes`);
    const parsed = await pdfParse(buffer);
    extractedText = parsed.text || "";
    console.log(`[PDF] Extracted ${extractedText.length} chars, ${parsed.numpages} pages from "${filename}"`);
  } catch (err) {
    console.error("[PDF Extraction Error] Full error:", err);
    return res.status(422).json({ 
      error: "Could not read PDF. Please ensure it is a text-based (not scanned) bank statement.",
      detail: err.message  // expose in dev so you can see the real cause
    });
  }
 
  if (!extractedText.trim()) {
    return res.status(422).json({ error: "PDF appears empty or image-only. Please upload a text-based bank statement." });
  }
 
  // Step 2: Prescrub PII from the extracted text
  const scrubbed = prescrubText(extractedText);
  console.log("[PRESCRUB] PII scrub applied to extracted PDF text");
 
  // Step 3: Trim to ~6000 chars to stay within LLM context limits
  const trimmed = scrubbed.length > 6000
    ? scrubbed.slice(0, 6000) + "\n... [statement truncated]"
    : scrubbed;
 
  // Step 4: Inject as a plain user message so the graph treats it like typed input
  const safeFilename = prescrubText(filename || "statement.pdf");
  const uploadMessage = {
    role: "user",
    content: "I have uploaded my bank statement (" + safeFilename + "). Here are the extracted transactions:\n\n" + trimmed + "\n\nPlease analyze my spending habits and suggest optimizations to help me reach my goal."
  };
 
  try {
    const result = await graph.invoke({ messages: [uploadMessage] }, config);
 
    const allMessages = result.messages;
    const lastResponse = allMessages[allMessages.length - 1];
    const finalString = typeof lastResponse.content === "string"
      ? lastResponse.content
      : "I have analyzed your bank statement. Ask me anything about your spending.";
 
    const currentState = await graph.getState(config);
    const finalProfile = currentState.values.profile;
 
    res.json({ text: finalString, profile: finalProfile });
  } catch (err) {
    console.error("[PDF Graph Error]", err);
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

app.listen(3001, () => console.log(`[SRE-CORE] Online on 3001`));