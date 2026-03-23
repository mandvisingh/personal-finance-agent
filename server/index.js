import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { wealthForecastTool, syncProfileTool} from "./tools.js";

const app = express();
app.use(cors());
app.use(express.json());

const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

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
  })
});

const model = new ChatGoogleGenerativeAI({
  model: "gemini-3.1-flash-lite-preview",
  apiKey: apiKey,
  temperature: 0,
});

const modelWithTools = model.bindTools([wealthForecastTool, syncProfileTool]);

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
  } 
else if (missing.length > 0 && userIsProvidingData) {
    return { isReadyForAnalysis: true }; 
  }  
  else if (missing.length > 0) {
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
      content: "System Profile Verified. Go ahead and share your recent transactions and I will analyze your spend habits." 
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

   const systemInstruction = `
    ROLE: Financial SRE & Analyst
    CONTEXT: User has $${state.profile.salary} income, $${state.profile.currentSavings} savings and goal of ${state.profile.goals}.
    GOAL: Identify waste, categorize expenses, and suggest how to achieve user's goal of  ${state.profile.goals}.
    MEMORY: ${state.summary || "No prior history."}
    
    OUTPUT REQUIREMENTS:
    - Provide a Markdown Table for any spending breakdown.
    - End with a summary of total annual potential savings.
    - If data is numeric, append: [CHART_DATA: {"Category": Amount, ...}]
    - Use standard Markdown syntax for tables.
    
    CRITICAL INSTRUCTIONS:
    1. If the user provides new info, ALWAYS call 'sync_profile' first.
    2. DATA COLLECTION MODE: If we are still missing ${missing.join(", ")}, DO NOT provide full budget analysis yet. 
       Instead, acknowledge the data you just received, confirm the sync, and politely ask for the remaining missing fields: ${missing.join(" and ")}.
    3. FULL ANALYSIS MODE: Only once all three (salary, savings, goals) are present should you provide budget breakdowns, tables, and [CHART_DATA].
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
  let profileUpdate = {};

  for (const toolCall of lastMessage.tool_calls) {
    let result;
    if (toolCall.name === "sync_profile") {
      const toolResponse = await syncProfileTool.invoke(toolCall.args, { configurable: { state } });
      const parsed = JSON.parse(toolResponse);
      profileUpdate = parsed.newProfile;
      result = parsed.status;
    } else if (toolCall.name === "wealth_forecast") {
      result = await wealthForecastTool.invoke(toolCall.args);
    }

    toolOutputs.push({
      role: "tool",
      content: typeof result === "string" ? result : JSON.stringify(result),
      tool_call_id: toolCall.id,
    });
  }

  return { messages: toolOutputs, profile: profileUpdate };
};
--
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

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;
  const config = { configurable: { thread_id: "user-session-1" } }; 

  const result = await graph.invoke(
    { messages: [messages[messages.length - 1]] }, 
    config
  );
  
  const allMessages = result.messages;
  let lastResponse = allMessages[allMessages.length - 1];

  let finalString = "";
  if (typeof lastResponse.content === 'string') {
    finalString = lastResponse.content;
  } else {
    finalString = "I've updated your financial profile and processed your request.";
  }

  res.json({ 
    text: finalString, 
    profile: result.profile 
  });
});

app.listen(3001, () => console.log(`[SRE-CORE] Online on 3001`));