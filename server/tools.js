import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const syncProfileTool = tool(
  async ({ salary, deposit, totalSavings, goals }, config) => {
    const currentState = config?.configurable?.state?.profile || {};
    const updatedSavings = totalSavings !== undefined 
      ? totalSavings 
      : (currentState.currentSavings || 0) + (deposit || 0);

    const newProfile = {
      salary: salary ?? currentState.salary,
      goals: goals ?? currentState.goals,
      currentSavings: updatedSavings
    };

    return JSON.stringify({
      status: "Profile synchronized",
      newProfile: newProfile
    });
  },
  {
    name: "sync_profile",
    description: "Updates the user's financial profile. Use 'deposit' to add to savings or 'totalSavings' to set an exact amount.",
    schema: z.object({
      salary: z.number().optional(),
      deposit: z.number().optional(),
      totalSavings: z.number().optional(),
      goals: z.string().optional(),
    }),
  }
);

export const wealthForecastTool = tool(
  async ({ currentSavings, monthlyContribution, years, interestRate }) => {
    const rate = (interestRate || 5) / 100 / 12;
    const months = years * 12;
    let total = currentSavings;
    for (let i = 0; i < months; i++) {
      total = (total + monthlyContribution) * (1 + rate);
    }
    return `Projected balance after ${years} years: $${total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  },
  {
    name: "wealth_forecast",
    description: "Calculate future wealth based on compound interest.",
    schema: z.object({
      currentSavings: z.number(),
      monthlyContribution: z.number(),
      years: z.number(),
      interestRate: z.number().optional(),
    }),
  }
);