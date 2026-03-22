# personal-finance-agent
An AI agent to help with personal finances
``` mermaid
graph TD
    %% User Interaction
    User((User)) -- "Analyze my 2024-2026 data" --> UI[Next.js / Tailwind UI]
    
    subgraph Frontend_Logic [Vercel AI SDK Client]
        UI --> Stream[streamText / useChat]
    end

    %% The Orchestration Loop with Memory Management
    subgraph Agent_Orchestrator [The Controller]
        Stream <--> LLM{GPT-4o / Claude 3.5}
        
        %% New Memory Management Logic
        LLM --- MemLogic{Memory Manager}
        MemLogic -- "Context < 80%" --> Pass[Pass Full History]
        MemLogic -- "Context > 80%" --> Compact[Summarize & Truncate]
        
        %% Tools
        LLM -- "1. Scrub PII" --> PII[scrub_pii_data Tool]
        LLM -- "2. Get Data" --> Fetch[get_bank_statement Tool]
        LLM -- "3. Compare" --> Goals[get_financial_goals Tool]
    end

    %% Internal Reasoning Personas
    subgraph Reasoning_Personas [Reasoning Layer]
        direction TB
        A[Bank Activity Agent] --- B[Spend Optimizer Agent]
        B --- C[Save/Goal Agent]
        C --- D[Advice Synthesis Agent]
    end
    LLM -.-> Reasoning_Personas

    %% Data & Persistence
    subgraph Data_Layer [Data & Persistence]
        Compact --> SummaryDB[(Rolling Summary Store)]
        Fetch --> CSV[(Anonymized CSV/JSON)]
        Goals --> DB[(User Goals Store)]
    end

    %% Final Output
    LLM -- "Structured Markdown" --> UI
```
