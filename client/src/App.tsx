import React, { useState } from 'react';
import { Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import FinancialChart from './chart.tsx'
import remarkGfm from 'remark-gfm';
import './App.css'; 

export default function App() {
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const latestProfile = [...messages].reverse().find(m => m.profile)?.profile;


  const handleSubmit = async (e: React.FormEvent) => {
    setIsLoading(true);
    e.preventDefault();
    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input };
    const updatedMessages = [...messages, userMsg];
    
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: updatedMessages.map(m => ({
            role: m.role === 'bot' ? 'assistant' : m.role,
            content: m.content || ''
          }))
        }),
      });

      const data = await response.json();
      if (data.text) {
        setMessages(prev => [...prev, { role: 'bot', content: data.text, profile: data.profile }]);
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setIsLoading(false);
    }
  };
  const getLatestProfile = () => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].profile) return messages[i].profile;
  }
  return { salary: 0, currentSavings: 0, goals: "" };
};

const currentStats = getLatestProfile();


  return (
    <div className="app-container">
      {messages.length === 0 && (
        <div className="intro-screen">Your Personal Finance Agent</div>
      )}

      <div className="chat-viewport">
        <div className="chat-max-width">
          
          {/* STICKY HEADER */}
          <div className="sticky-header">
            <div className="stat-salary">💰 Salary: ${currentStats.salary || 0}</div>
            <div className="stat-savings">🏦 Savings: ${currentStats.currentSavings || 0}</div>
            <div className="stat-goal">🎯 Goal: {currentStats.goals || 'Not set'}</div>
          </div>

          {messages.map((m, i) => (
            <div key={i} className={`message-row ${m.role === 'user' ? 'user' : 'bot'}`}>
              <div className={`bubble ${m.role === 'user' ? 'user' : 'bot'}`}>
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content.replace(/\[CHART_DATA:.*?\]/g, '')}
                  </ReactMarkdown>
                  {m.content.includes('[CHART_DATA:') && <FinancialChart rawData={m.content} />}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="loading-indicator">
              <span className="loading-bubble">Agent is analyzing...</span>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="input-form">
        <div className="input-container">
          <input
            className="chat-input"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="send-button">
            <Send size={18} color="#000" />
          </button>
        </div>
      </form>
    </div>
  );
}