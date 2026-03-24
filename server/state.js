import { Annotation } from "@langchain/langgraph";

export const FinancialState = Annotation.Root({
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
  summary:            Annotation({ reducer: (_, next) => next, default: () => "" }),
  isReadyForAnalysis: Annotation({ reducer: (_, next) => next, default: () => false }),
  statementText:      Annotation({ reducer: (_, next) => next, default: () => "" }),
});
