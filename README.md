# Personal Finance Agent

An AI-powered personal finance assistant that analyses bank statements, categorises spending, and projects future wealth. Built with a LangGraph multi-agent backend and a React chat frontend.

**Live demo:** https://personal-finance-agent-production-ac82.up.railway.app

---

## Features

- **Conversational onboarding** — collects monthly income, savings, and financial goal through natural dialogue
- **Bank statement upload** — accepts PDF bank statements; text is extracted server-side before any LLM call
- **PII prescrubbing** — SSNs, card numbers, emails, phone numbers, names, addresses, and dates of birth are redacted before reaching the model — applies to both typed messages and uploaded PDFs
- **PII redaction visualisation** — a collapsible badge in the UI shows exactly what was redacted and a preview of the scrubbed text
- **LLM-powered categorisation** — the model uses its world knowledge to categorise transactions (e.g. "TST-MENYA MORI" → Food, "CANCO PETROLEUM" → Transport) — no keyword rules
- **Spending analysis** — flags anomalies, computes savings rate, returns chart-ready totals by category
- **Wealth forecasting** — compound-interest projections over configurable time horizons with actionable improvement levers
- **Interactive charts** — donut charts rendered from structured data embedded in model responses
- **LLM-based intent routing** — an async LLM call classifies each message as spending or wealth intent before dispatching to the correct subagent
- **Pluggable LLM** — swap between OpenAI and Google Gemini via a single environment variable

---

## Architecture

```
personal-finance-agent/
├── client/                   # React + Vite + TypeScript frontend
│   └── src/
│       ├── App.tsx           # Chat UI, PDF upload, profile sidebar
│       ├── chart.tsx         # Recharts donut chart renderer
│       └── App.css           # Design tokens + component styles
└── server/                   # Node.js + Express + LangGraph backend
    ├── index.js              # Express routes + PII scrubbing
    ├── graph.js              # LangGraph StateGraph + LLM router
    ├── nodes.js              # Agent node implementations
    ├── tools.js              # LangChain tool definitions
    ├── models.js             # LLM instantiation + tool binding
    ├── state.js              # FinancialState schema + reducers
    ├── prompts.js            # System prompt builders
    ├── pii.js                # PII prescrubbing rules + stats
    ├── pdf.js                # PDF text extraction (pdfjs-dist)
    └── logger.js             # Namespaced logger utility
```

### Agent graph

```
START
  └─► summarizer      rolling conversation compressor (fires at >8 messages, only when profile complete)
        └─► gatekeeper    deterministic profile-completeness check (no LLM)
              ├─► [END]          if profile incomplete — returns static nudge
              └─► routeByIntent  async LLM classifies intent as "spending" or "wealth"
                    ├─► spendingAgent   ◄──► spendingTools
                    └─► wealthAgent     ◄──► wealthTools
```

**Summarizer** — fires when message history exceeds 8 entries and the user profile is complete. Distils the conversation into a rolling summary, keeping context window usage low.

**Gatekeeper** — no LLM call; checks whether salary, savings, and goals are all present. Routes to the correct subagent or returns a static nudge asking for the missing fields.

**`routeByIntent`** — async LLM call that classifies the user's message as `"spending"` or `"wealth"` intent. This is a conditional edge on the gatekeeper, so it only fires when the gatekeeper has confirmed the profile is ready. Routes retirement/forecast/investment intent to the wealth agent; transaction analysis, budget review, and profile collection go to the spending agent.

**Spending subagent** — handles transaction analysis and profile collection. Has access to three tools:

| Tool | Purpose |
|------|---------|
| `extract_statement` | Reads the bank statement text from LangGraph state (text never travels through the LLM prompt) |
| `sync_profile` | Persists salary, savings, and goals into graph state |
| `spending_analysis` | Receives pre-categorised transactions from the LLM, computes totals, savings rate, anomalies, and chart data |

**Wealth subagent** — handles forward-looking projections. Has access to two tools:

| Tool | Purpose |
|------|---------|
| `sync_profile` | Same as above — always available in both agents; called first to persist any profile data the user provides |
| `wealth_forecast` | Compound-interest calculator; projects balance over N years at a given rate |

### Categorisation design

The LLM categorises each transaction using its world knowledge before passing them to `spending_analysis`. Categories are free-form strings — the tool accepts whatever the LLM decides (Food, Transport, Pets, Health, etc.) rather than a fixed enum. This means:

- No brittle keyword lists to maintain
- Real merchant names are understood correctly
- New categories can emerge naturally and will persist cleanly when a database is added

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React, Vite, TypeScript |
| Charts | Recharts |
| Markdown | react-markdown + remark-gfm |
| Backend | Node.js 20+, Express |
| Agent framework | LangGraph (`@langchain/langgraph`) |
| LLMs | Google Gemini (`@langchain/google-genai`) · OpenAI (`@langchain/openai`) |
| PDF extraction | pdfjs-dist (server-side, no LLM) |
| Schema validation | Zod |
| Deployment | Railway (server + client as separate services) |

---

## Getting started

### Prerequisites

- Node.js 20+
- An API key for Google Gemini **or** OpenAI

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure the server

Create `server/.env`:

```env
LLM_PROVIDER=google          # or "openai"

GOOGLE_API_KEY=your-google-api-key
# OPENAI_API_KEY=your-openai-api-key
```

### 3. Run

```bash
# From the repo root — starts both client and server
npm run dev
```

Or separately:

```bash
npm run dev:client   # Vite dev server  → http://localhost:5173
npm run dev:server   # Node with --watch → http://localhost:3001
```

---

## API

### `POST /api/chat`

**Request**
```json
{
  "messages": [{ "role": "user", "content": "My salary is $5,000/month" }],
  "threadId": "uuid"
}
```

**Response**
```json
{
  "text": "Got it! I've saved your monthly income...",
  "profile": { "salary": 5000, "currentSavings": null, "goals": null },
  "piiStats": {
    "counts": { "PHONE": 1, "EMAIL": 2 },
    "preview": "First 300 chars of the scrubbed message..."
  }
}
```

`piiStats.counts` is an object of `{ piiType: count }` pairs. It is omitted when no PII was found.

### `POST /api/upload-pdf`

**Request**
```json
{
  "base64Pdf": "<base64-encoded PDF>",
  "filename": "statement.pdf",
  "threadId": "uuid"
}
```

**Response** — same shape as `/api/chat` including `piiStats`. Extracted + prescrubbed text is stored in LangGraph state under `statementText`; the spending agent retrieves it via `extract_statement` rather than receiving it in the prompt.

### `GET /health`

Returns `{ "status": "ok" }`.

---

## PDF processing pipeline

```
Upload
  → pdfjs-dist extracts raw text (server-side, no LLM)
  → PII prescrub (regex redaction) + stats collected
  → trimmed to 15,000 chars
  → stored in LangGraph statementText state field
  → spendingAgent: extract_statement → LLM categorises transactions → spending_analysis
```

## Chat message pipeline

```
User message
  → PII prescrub (regex redaction) + stats collected
  → scrubbed message sent to LangGraph graph
  → piiStats returned alongside bot response
  → UI shows 🔒 badge if any PII was redacted
```

### PII redaction rules

| Type | Replacement |
|------|-------------|
| SSN (`123-45-6789`) | `[SSN REDACTED]` |
| Card number | `[CARD ...1234]` (last 4 preserved) |
| Account number | `ACCT [...5678]` (last 4 preserved) |
| Email address | `[EMAIL REDACTED]` |
| Phone number | `[PHONE REDACTED]` |
| Titled name (`Mr. John Smith`) | `[NAME REDACTED]` |
| Street address | `[ADDRESS REDACTED]` |
| ZIP / postal code | `[ZIP REDACTED]` |
| Date of birth | `[DOB REDACTED]` |

---

## Chart format

Agents embed structured data at the end of their response when a chart is warranted:

```
[CHART_DATA: {"Food": 480, "Transport": 150, "Housing": 1200}]
```

The frontend strips this tag from the displayed text and passes the JSON to `FinancialChart`, which renders a labelled donut chart via Recharts.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `google` | `"google"` or `"openai"` |
| `GOOGLE_API_KEY` | If using Google | — | Gemini API key |
| `OPENAI_API_KEY` | If using OpenAI | — | OpenAI API key |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `PORT` | No | `3001` | Server port (set automatically by Railway) |
| `VITE_API_URL` | Client build | `http://localhost:3001` | Backend URL baked into the client at build time |


## UI DESIGNS

<img width="1440" height="779" alt="Screenshot 2026-03-24 at 4 01 26 PM" src="https://github.com/user-attachments/assets/03206adb-3b28-41f2-bdbe-80f7024a18ab" />
<img width="1438" height="693" alt="Screenshot 2026-03-24 at 4 01 08 PM" src="https://github.com/user-attachments/assets/c2f18636-c649-4e93-b823-e82833848237" />
<img width="1440" height="687" alt="Screenshot 2026-03-24 at 4 00 16 PM" src="https://github.com/user-attachments/assets/5a761f7c-5d86-4a96-acbf-fef099854c1c" />
