import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { graph } from "./graph.js";
import { prescrubText, prescrubWithStats } from "./pii.js";
import { pdfParse } from "./pdf.js";
import { createLogger } from "./logger.js";

// Re-export pure utilities so existing tests keep working without path changes
export { prescrubText } from "./pii.js";
export { getMissingFields } from "./nodes.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const log    = createLogger("server");
const pdfLog = createLogger("pdf");
const apiLog = createLogger("api");

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/chat', async (req, res) => {
  const { messages, threadId } = req.body;
  const config = { configurable: { thread_id: threadId ?? "default" } };
  apiLog.info(`POST /api/chat — thread: ${threadId}, messages: ${messages?.length}`);

  try {
    const lastMsg = messages[messages.length - 1];
    const { scrubbed, counts } = prescrubWithStats(lastMsg.content ?? "");
    const scrubbedPreview = scrubbed.slice(0, 300);
    const scrubbedMessage = { ...lastMsg, content: scrubbed };

    const result = await graph.invoke({ messages: [scrubbedMessage] }, config);
    const last = result.messages[result.messages.length - 1];
    const text = typeof last.content === "string" ? last.content : "I've processed your request.";
    const currentState = await graph.getState(config);
    res.json({ text, profile: currentState.values.profile, piiStats: { counts, preview: scrubbedPreview } });
  } catch (err) {
    apiLog.error("/api/chat failed", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-pdf', async (req, res) => {
  const { base64Pdf, filename, threadId } = req.body;
  const config = { configurable: { thread_id: threadId ?? "default" } };
  apiLog.info(`POST /api/upload-pdf — thread: ${threadId}, file: ${filename}`);

  if (!base64Pdf) return res.status(400).json({ error: "No PDF data provided" });

  const bufferCheck = Buffer.from(base64Pdf.slice(0, 20), "base64").toString("ascii");
  if (!bufferCheck.startsWith("%PDF")) {
    return res.status(400).json({ error: "Invalid PDF: does not start with %PDF header." });
  }

  let extractedText = "";
  try {
    const buffer = Buffer.from(base64Pdf, "base64");
    const parsed = await pdfParse(buffer);
    extractedText = parsed.text || "";
    pdfLog.info(`Extracted ${parsed.numpages} pages, ${extractedText.length} chars from "${filename}"`);
  } catch (err) {
    pdfLog.error("pdfjs extraction threw", err);
    pdfLog.error("Extraction failed", err.message);
    return res.status(422).json({ error: "Could not read PDF. Ensure it is text-based, not a scanned image.", detail: err.message });
  }

  if (!extractedText.trim()) {
    return res.status(422).json({ error: "PDF appears empty or image-only." });
  }

  const { scrubbed, counts } = prescrubWithStats(extractedText);
  const trimmed = scrubbed.length > 15000 ? scrubbed.slice(0, 15000) + "\n... [truncated]" : scrubbed;
  const scrubbedPreview = scrubbed.slice(0, 300);

  const uploadMessage = {
    role: "user",
    content: `I've uploaded my bank statement (${prescrubText(filename || "statement.pdf")}). Please call extract_statement to read it, then analyse my spending.`,
  };

  try {
    const result = await graph.invoke({ messages: [uploadMessage], statementText: trimmed }, config);
    const last = result.messages[result.messages.length - 1];
    const text = typeof last.content === "string" ? last.content : "Bank statement analysed.";
    const currentState = await graph.getState(config);
    res.json({ text, profile: currentState.values.profile, piiStats: { counts, preview: scrubbedPreview } });
  } catch (err) {
    apiLog.error("/api/upload-pdf graph invocation failed", err);
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== "test") {
  const PORT = process.env.PORT ?? 3001;
  app.listen(PORT, () => log.info(`Server online on :${PORT} · provider: ${process.env.LLM_PROVIDER || "google"}`));
}
