import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { FinancialState } from "./state.js";
import { model } from "./models.js";
import { createLogger } from "./logger.js";
import {
  summarizerNode,
  gatekeeperNode,
  spendingAgentNode,
  wealthAgentNode,
  spendingToolNode,
  wealthToolNode,
} from "./nodes.js";

const log = createLogger("router");
const hasToolCalls = (s) => s.messages[s.messages.length - 1].tool_calls?.length > 0;

async function routeByIntent(s) {
  if (!s.isReadyForAnalysis) return END;
  const lastUserMsg = [...s.messages].reverse().find(m => m.role === "user")?.content ?? "";
  const response = await model.invoke([
    { role: "system", content: `You are a router. Reply with exactly one word — "spending" or "wealth" — based on the user's intent.\n- "wealth": retirement, forecasting, investment, future projections, compound interest, or goals related to retirement/financial independence\n- "spending": transaction analysis, budget review, categorising expenses, uploading a bank statement, or providing salary/savings figures` },
    { role: "user", content: typeof lastUserMsg === "string" ? lastUserMsg : "" },
  ]);
  const route = response.content.toLowerCase().includes("wealth") ? "wealthAgent" : "spendingAgent";
  log.info(`Routed to ${route} for: "${lastUserMsg.slice(0, 60)}"`);
  return route;
}

const workflow = new StateGraph(FinancialState)
  .addNode("summarizer",    summarizerNode)
  .addNode("gatekeeper",    gatekeeperNode)
  .addNode("spendingAgent", spendingAgentNode)
  .addNode("wealthAgent",   wealthAgentNode)
  .addNode("spendingTools", spendingToolNode)
  .addNode("wealthTools",   wealthToolNode)
  .addEdge(START, "summarizer")
  .addEdge("summarizer", "gatekeeper")
  .addConditionalEdges("gatekeeper", routeByIntent)
  .addConditionalEdges("spendingAgent", (s) => hasToolCalls(s) ? "spendingTools" : END)
  .addEdge("spendingTools", "spendingAgent")
  .addConditionalEdges("wealthAgent", (s) => hasToolCalls(s) ? "wealthTools" : END)
  .addEdge("wealthTools", "wealthAgent");

export const graph = workflow.compile({ checkpointer: new MemorySaver() });
