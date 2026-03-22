// server.js
import express from 'express';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const { messages } = req.json();

  const result = await streamText({
    model: openai('gpt-4o'),
    messages,
    system: "You are a Personal Finance Analyst and Advisor. Analyze the user's data for efficiency and safety.",
  });

  result.pipeUIMessageStreamToResponse(res);
});

app.listen(3001, () => console.log('SRE Backend running on port 3001'));