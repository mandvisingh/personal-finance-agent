import { model, spendingModel, wealthModel } from "./models.js";
import { buildBasePrompt, buildSpendingPrompt, buildWealthPrompt } from "./prompts.js";
import { extractStatementTool, syncProfileTool, spendingAnalysisTool, wealthForecastTool } from "./tools.js";
import { createLogger } from "./logger.js";

const agentLog = createLogger("agent");
const toolLog  = createLogger("tools");

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMissingFields(profile) {
  const missing = [];
  if (!profile.salary)         missing.push("monthly income");
  if (!profile.goals)          missing.push("financial goals");
  if (!profile.currentSavings) missing.push("current savings");
  return missing;
}

/** Execute sync_profile and return { output, profileUpdate } */
async function runSyncProfile(toolCall, state, currentProfileUpdate) {
  const freshState = { ...state, profile: currentProfileUpdate ?? state.profile };
  const raw = await syncProfileTool.invoke(toolCall.args, { configurable: { state: freshState } });
  const parsed = JSON.parse(raw);
  return { output: parsed.status, profileUpdate: parsed.newProfile };
}

// ─── Nodes ───────────────────────────────────────────────────────────────────

/** Rolling summariser — only fires when conversation grows long */
export const summarizerNode = async (state) => {
  if (state.messages.length < 8) return {};
  if (getMissingFields(state.profile).length > 0) return {};
  agentLog.info(`Summariser fired — compressing ${state.messages.length} messages`);
  const response = await model.invoke([
    { role: "system", content: `Distill this conversation into a concise summary. Incorporate existing summary: "${state.summary}". Focus on financial facts, numbers, and goals.` },
    ...state.messages,
  ]);
  return { summary: response.content, messages: state.messages.slice(-2) };
};

/**
 * Gatekeeper — pure deterministic logic, no LLM calls.
 * Checks profile completeness and whether the user is actively providing data.
 * Routes to the correct subagent or returns a static nudge.
 */
export const gatekeeperNode = (state) => {
  const p = state.profile;
  const lastContent = state.messages[state.messages.length - 1]?.content ?? "";
  const lastMsg = typeof lastContent === "string" ? lastContent.toLowerCase() : "";

  const missing = getMissingFields(p);

  const userIsProvidingData =
    lastMsg.includes("salary") ||
    lastMsg.includes("income") ||
    lastMsg.includes("earn") ||
    lastMsg.includes("save") ||
    lastMsg.includes("goal") ||
    lastMsg.includes("retire") ||
    lastMsg.includes("want to") ||
    lastMsg.includes("statement") ||
    lastMsg.includes("transaction") ||
    /\$?\d{3,}/.test(lastMsg) ||
    /\d+\s*[kK]\b/.test(lastMsg);

  if (missing.length === 3 && !userIsProvidingData) {
    agentLog.debug("Gatekeeper: no profile and no actionable input — returning welcome message");
    return {
      messages: [{
        role: "assistant",
        content: "👋 I'm your Personal Finance Analyst. To get started, I need three things:\n\n1. **Monthly income** — your take-home salary\n2. **Current savings** — your total saved so far\n3. **Financial goal** — e.g. \"save $20k for a house\" or \"retire early\"\n\nYou can type these or upload a bank statement PDF using the 📎 button.",
      }],
      isReadyForAnalysis: false,
    };
  }

  if (missing.length > 0 && !userIsProvidingData) {
    agentLog.debug(`Gatekeeper: nudging for missing fields — ${missing.join(", ")}`);
    const missingStr = missing.map(f => `**${f}**`).join(", ");
    return {
      messages: [{
        role: "assistant",
        content: `Almost there! I still need your ${missingStr} to unlock full analysis. What are those values?`,
      }],
      isReadyForAnalysis: false,
    };
  }

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

  return { isReadyForAnalysis: true };
};

/** Spending subagent — extract_statement, sync_profile, spending_analysis */
export const spendingAgentNode = async (state) => {
  const missing = getMissingFields(state.profile);
  const base = buildBasePrompt(state.profile, state.summary, missing);
  const systemPrompt = buildSpendingPrompt(base, missing);
  agentLog.info("Routing to spending subagent");
  const response = await spendingModel.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response] };
};

/** Wealth subagent — sync_profile, wealth_forecast */
export const wealthAgentNode = async (state) => {
  const missing = getMissingFields(state.profile);
  const base = buildBasePrompt(state.profile, state.summary, missing);
  const systemPrompt = buildWealthPrompt(base);
  agentLog.info("Routing to wealth subagent");
  const response = await wealthModel.invoke([
    { role: "system", content: systemPrompt },
    ...state.messages,
  ]);
  return { messages: [response] };
};

/** Tool executor for spending subagent */
export const spendingToolNode = async (state) => {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolOutputs = [];
  let profileUpdate = null;

  for (const toolCall of lastMessage.tool_calls) {
    let output;
    toolLog.debug(`Calling tool: ${toolCall.name}`, toolCall.args);

    if (toolCall.name === "sync_profile") {
      const r = await runSyncProfile(toolCall, state, profileUpdate);
      profileUpdate = r.profileUpdate;
      output = r.output;
      toolLog.info(`sync_profile updated profile: ${JSON.stringify(profileUpdate)}`);
    } else if (toolCall.name === "extract_statement") {
      output = await extractStatementTool.invoke(toolCall.args, { configurable: { state } });
      toolLog.info(`extract_statement returned ${output?.length ?? 0} chars`);
    } else if (toolCall.name === "spending_analysis") {
      output = await spendingAnalysisTool.invoke(toolCall.args);
      toolLog.info("spending_analysis complete");
    } else {
      toolLog.warn(`Unknown tool called in spendingToolNode: ${toolCall.name}`);
    }

    toolOutputs.push({ role: "tool", content: output, tool_call_id: toolCall.id });
  }

  const stateUpdate = { messages: toolOutputs };
  if (profileUpdate !== null) stateUpdate.profile = profileUpdate;
  return stateUpdate;
};

/** Tool executor for wealth subagent */
export const wealthToolNode = async (state) => {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolOutputs = [];
  let profileUpdate = null;

  for (const toolCall of lastMessage.tool_calls) {
    let output;
    toolLog.debug(`Calling tool: ${toolCall.name}`, toolCall.args);

    if (toolCall.name === "sync_profile") {
      const r = await runSyncProfile(toolCall, state, profileUpdate);
      profileUpdate = r.profileUpdate;
      output = r.output;
      toolLog.info(`sync_profile updated profile: ${JSON.stringify(profileUpdate)}`);
    } else if (toolCall.name === "wealth_forecast") {
      output = await wealthForecastTool.invoke(toolCall.args);
      toolLog.info(`wealth_forecast result: ${output}`);
    } else {
      toolLog.warn(`Unknown tool called in wealthToolNode: ${toolCall.name}`);
    }

    toolOutputs.push({ role: "tool", content: output, tool_call_id: toolCall.id });
  }

  const stateUpdate = { messages: toolOutputs };
  if (profileUpdate !== null) stateUpdate.profile = profileUpdate;
  return stateUpdate;
};
