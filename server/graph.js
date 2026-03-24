import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { FinancialState } from "./state.js";
import { detectMode } from "./prompts.js";
import {
  summarizerNode,
  gatekeeperNode,
  spendingAgentNode,
  wealthAgentNode,
  spendingToolNode,
  wealthToolNode,
} from "./nodes.js";

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

export const graph = workflow.compile({ checkpointer: new MemorySaver() });
