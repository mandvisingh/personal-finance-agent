# Personal Finance Agent

An AI-powered personal finance assistant that analyses bank statements, categorises spending, and projects future wealth. Built with a LangGraph multi-agent backend and a React chat frontend.

---

## Features

- **Conversational onboarding** — collects monthly income, savings, and financial goal through natural dialogue
- **Bank statement upload** — accepts PDF bank statements; text is extracted server-side before any LLM call
- **PII prescrubbing** — SSNs, card numbers, emails, phone numbers, names, addresses, and dates of birth are redacted before reaching the model
- **Spending analysis** — categorises transactions into Housing / Food / Transport / Entertainment / Subscriptions / Other, flags anomalies, computes savings rate
- **Wealth forecasting** — compound-interest projections over configurable time horizons with actionable improvement levers
- **Interactive charts** — donut charts rendered from structured data embedded in model responses
- **Pluggable LLM** — swap between OpenAI and Google Gemini via a single environment variable

---

## Architecture

```
personal-finance-agent/
├── client/          # React 19 + Vite + TypeScript frontend
│   └── src/
│       ├── App.tsx          # Chat UI, PDF upload, profile sidebar
│       ├── chart.tsx        # Recharts donut chart renderer
│       ├── App.css          # Design tokens + component styles
│       └── main.tsx         # Entry point
└── server/          # Node.js + Express + LangGraph backend
    ├── index.js     # Graph definition, routes, PII scrubber, PDF extractor
    └── tools.js     # LangChain tool definitions
```

### Agent graph

```
START
  └─► summarizer      rolling conversation compressor (fires at >8 messages)
        └─► gatekeeper    deterministic profile-completeness check
              ├─► spendingAgent   ◄──► spendingTools
              └─► wealthAgent     ◄──► wealthTools
```

**Summarizer** — fires when message history exceeds 8 entries. Distils the conversation into a rolling summary and trims the message list to the last 2, keeping context window usage low.

**Gatekeeper** — no LLM call; checks whether the user profile (salary, savings, goals) is complete and whether the user's latest message is providing new data. Routes to the correct subagent or returns a static nudge if nothing actionable has been said yet.

**Spending subagent** — handles transaction analysis and profile collection. Has access to three tools:

| Tool | Purpose |
|------|---------|
| `extract_statement` | Reads the bank statement text from LangGraph state (text never travels through the LLM prompt) |
| `sync_profile` | Persists salary, savings, and goals into graph state |
| `spending_analysis` | Keyword-categorises transactions, flags anomalies, returns chart-ready totals |

**Wealth subagent** — handles forward-looking projections. Has access to two tools:

| Tool | Purpose |
|------|---------|
| `sync_profile` | Same as above — always available in both agents |
| `wealth_forecast` | Compound-interest calculator; projects balance over N years at a given rate |

Mode detection is keyword-based on the last user message (`"forecast"`, `"retire"`, `"invest"`, `"project"`, etc. → wealth; everything else → spending).

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4 |
| Charts | Recharts |
| Markdown | react-markdown + remark-gfm |
| Backend | Node.js, Express 4 |
| Agent framework | LangGraph (`@langchain/langgraph`) |
| LLMs | OpenAI (`@langchain/openai`) · Google Gemini (`@langchain/google-genai`) |
| PDF extraction | pdfjs-dist (no LLM involved) |
| Schema validation | Zod |

---

## Getting started

### Prerequisites

- Node.js 18+
- An API key for OpenAI **or** Google Gemini

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure the server

Create `server/.env`:

```env
# Pick one provider
LLM_PROVIDER=google          # or "openai"

GOOGLE_API_KEY=your-google-api-key
# OPENAI_API_KEY=your-openai-api-key
```

### 3. Run

```bash
# From the repo root — starts both client (port 5173) and server (port 3001)
npm run dev
```

Or start them separately:

```bash
npm run dev:client   # Vite dev server  → http://localhost:5173
npm run dev:server   # Node with --watch → http://localhost:3001
```

---

## API

### `POST /api/chat`

Text message turn.

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
  "profile": { "salary": 5000, "currentSavings": null, "goals": null }
}
```

### `POST /api/upload-pdf`

Bank statement upload.

**Request**
```json
{
  "base64Pdf": "<base64-encoded PDF>",
  "filename": "statement.pdf",
  "threadId": "uuid"
}
```

**Response** — same shape as `/api/chat`. The extracted + prescrubbed text is stored in LangGraph state under `statementText`; the spending agent calls `extract_statement` to retrieve it rather than receiving it in the prompt.

---

## PDF processing pipeline

```
Upload
  → pdfjs-dist extracts raw text (server-side, zero LLM involvement)
  → PII prescrub (regex redaction, see table below)
  → trimmed to 6,000 chars to stay within context limits
  → stored in LangGraph statementText state field
  → user message injected: "please call extract_statement"
  → spendingAgent: extract_statement → sync_profile → spending_analysis
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
| ZIP code | `[ZIP REDACTED]` |
| Date of birth | `[DOB REDACTED]` |

---

## Spending categories

Transactions are classified by keyword matching against the merchant/description field:

| Category | Example keywords |
|----------|-----------------|
| Housing | rent, mortgage, utilities, electric, internet |
| Food | grocery, restaurant, doordash, starbucks, ubereats |
| Transport | uber, lyft, gas station, parking, airline |
| Entertainment | netflix, spotify, steam, cinema, hulu |
| Subscriptions | membership, gym, adobe, icloud, dropbox |
| Other | anything not matched above |

Anomalies are flagged when a single transaction exceeds 2× the category average **and** is over $50.

---

## Chart format

Agents append structured data at the end of their response when a visualisation is warranted:

```
[CHART_DATA: {"Housing": 1200, "Food": 480, "Transport": 150}]
```

The frontend strips this tag from the displayed text and passes the JSON to `FinancialChart`, which renders a labelled donut chart via Recharts.

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_PROVIDER` | No | `google` | `"google"` or `"openai"` |
| `GOOGLE_API_KEY` | If using Google | — | Gemini API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Alias | — | Alternative Gemini key name |
| `OPENAI_API_KEY` | If using OpenAI | — | OpenAI API key |


## UI DESIGNS

<img width="1440" height="779" alt="Screenshot 2026-03-24 at 4 01 26 PM" src="https://github.com/user-attachments/assets/03206adb-3b28-41f2-bdbe-80f7024a18ab" />
<img width="1438" height="693" alt="Screenshot 2026-03-24 at 4 01 08 PM" src="https://github.com/user-attachments/assets/c2f18636-c649-4e93-b823-e82833848237" />
<img width="1440" height="687" alt="Screenshot 2026-03-24 at 4 00 16 PM" src="https://github.com/user-attachments/assets/5a761f7c-5d86-4a96-acbf-fef099854c1c" />
