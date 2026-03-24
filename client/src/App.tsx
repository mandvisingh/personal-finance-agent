import React, { useState, useRef } from 'react';
import { Send, Paperclip, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import FinancialChart from './chart.tsx'
import remarkGfm from 'remark-gfm';
import './App.css'; 

// Fixed: added profile to the message type so TypeScript doesn't complain
interface Message {
  role: string;
  content: string;
  profile?: { salary: number | null; currentSavings: number | null; goals: string | null };
  isPdf?: boolean;
  pdfName?: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingPdf, setPendingPdf] = useState<{ file: File; base64: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [threadId] = useState(() => crypto.randomUUID());


  const getLatestProfile = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].profile) return messages[i].profile!;
    }
    return { salary: null, currentSavings: null, goals: null };
  };

  const currentStats = getLatestProfile();

  // Converts a File to a base64 string
  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data URL prefix: "data:application/pdf;base64,..."
        resolve(result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('PDF must be under 10MB');
      return;
    }
    const base64 = await readFileAsBase64(file);
    setPendingPdf({ file, base64 });
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); // Fixed: moved before setIsLoading to prevent stuck loading state
    if (!input.trim() && !pendingPdf) return;
    setIsLoading(true);

    // ── PDF upload path ──
    if (pendingPdf) {
      const pdfMsg: Message = {
        role: 'user',
        content: `📄 Uploaded bank statement: **${pendingPdf.file.name}**`,
        isPdf: true,
        pdfName: pendingPdf.file.name,
      };
      setMessages(prev => [...prev, pdfMsg]);
      setPendingPdf(null);

      try {
        const response = await fetch('http://localhost:3001/api/upload-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Pdf: pendingPdf.base64, filename: pendingPdf.file.name, threadId }),
        });
        const data = await response.json();
        if (data.text) {
          setMessages(prev => [...prev, { role: 'bot', content: data.text, profile: data.profile }]);
        }
      } catch (error) {
        console.error('PDF upload error:', error);
        setMessages(prev => [...prev, { role: 'bot', content: '⚠️ Failed to process the PDF. Please try again.' }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Regular chat path ──
    const userMsg: Message = { role: 'user', content: input };
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
        }, threadId),
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
              <div className={`bubble ${m.role === 'user' ? 'user' : 'bot'} ${m.isPdf ? 'pdf-bubble' : ''}`}>
                <div className="markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content.replace(/\[CHART_DATA:.*?\]/gs, '')}
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

      {/* PDF preview pill shown above the input bar */}
      {pendingPdf && (
        <div className="pdf-preview-bar">
          <span className="pdf-preview-name">📄 {pendingPdf.file.name}</span>
          <button className="pdf-remove-btn" onClick={() => setPendingPdf(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="input-form">
        <div className="input-container">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          {/* Paperclip button */}
          <button
            type="button"
            className="attach-button"
            onClick={() => fileInputRef.current?.click()}
            title="Upload bank statement PDF"
          >
            <Paperclip size={18} color="#a1a1aa" />
          </button>

          <input
            className="chat-input"
            placeholder={pendingPdf ? "Add a message with your PDF, or just hit send..." : "Type a message..."}
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