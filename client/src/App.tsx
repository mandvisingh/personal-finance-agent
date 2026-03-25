import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { Send, Paperclip, X, TrendingUp, PiggyBank, Target, AlertTriangle, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import FinancialChart from './chart.tsx';
import remarkGfm from 'remark-gfm';
import './App.css';

// ─── Error Boundary ───────────────────────────────────────────────────────────

interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="error-boundary">
          <AlertTriangle size={32} className="error-boundary-icon" />
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message ?? 'An unexpected error occurred.'}</p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  salary: number | null;
  currentSavings: number | null;
  goals: string | null;
}

interface PiiStats {
  counts: Record<string, number>;
  preview: string;
}

interface Message {
  role: string;
  content: string;
  profile?: Profile;
  isPdf?: boolean;
  isError?: boolean;
  piiStats?: PiiStats;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatCurrency = (n: number | null) =>
  n != null ? `$${n.toLocaleString()}` : '—';

// ─── Config ───────────────────────────────────────────────────────────────────

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// ─── Main App ─────────────────────────────────────────────────────────────────

function FinanceApp() {
  const WELCOME: Message = {
    role: 'bot',
    content: "👋 I'm your Personal Finance Analyst. To get started, I need three things:\n\n1. **Monthly income** — your take-home salary\n2. **Current savings** — your total saved so far\n3. **Financial goal** — e.g. \"save $20k for a house\" or \"retire early\"\n\nYou can type these or upload a bank statement PDF using the 📎 button.",
  };
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [pendingPdf, setPendingPdf] = useState<{ file: File; base64: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());

  const getLatestProfile = (): Profile => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].profile) return messages[i].profile!;
    }
    return { salary: null, currentSavings: null, goals: null };
  };

  const currentStats = getLatestProfile();
  const hasProfile = currentStats.salary || currentStats.currentSavings || currentStats.goals;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, isPdfLoading]);

  const addErrorMessage = (text: string) => {
    setMessages(prev => [...prev, { role: 'bot', content: text, isError: true }]);
  };

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      addErrorMessage('Only PDF files are supported. Please upload a bank statement in PDF format.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      addErrorMessage('PDF must be under 10MB. Try exporting a shorter date range from your bank.');
      return;
    }
    const base64 = await readFileAsBase64(file);
    setPendingPdf({ file, base64 });
    e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !pendingPdf) return;

    if (pendingPdf) {
      const captured = pendingPdf;
      setPendingPdf(null);
      setIsPdfLoading(true);

      setMessages(prev => [...prev, {
        role: 'user',
        content: `Uploaded bank statement: **${captured.file.name}**`,
        isPdf: true,
      }]);

      try {
        const res = await fetch(`${API_URL}/api/upload-pdf`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64Pdf: captured.base64, filename: captured.file.name, threadId }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `Server error ${res.status}`);
        }

        const data = await res.json();
        if (data.text) {
          setMessages(prev => [...prev, { role: 'bot', content: data.text, profile: data.profile, piiStats: data.piiStats }]);
        }
      } catch (err: any) {
        addErrorMessage(err.message ?? 'Failed to process the PDF. Please try again.');
      } finally {
        setIsPdfLoading(false);
      }
      return;
    }

    const userMsg: Message = { role: 'user', content: input };
    const updatedMessages = [...messages, userMsg];
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map(m => ({
            role: m.role === 'bot' ? 'assistant' : m.role,
            content: m.content || '',
          })),
          threadId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Server error ${res.status}`);
      }

      const data = await res.json();
      if (data.text) {
        setMessages(prev => [...prev, { role: 'bot', content: data.text, profile: data.profile, piiStats: data.piiStats }]);
      }
    } catch (err: any) {
      addErrorMessage(err.message ?? 'Could not reach the server. Is it running on port 3001?');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) handleSubmit(e as any);
  };

  const anyLoading = isLoading || isPdfLoading;

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark"><TrendingUp size={18} /></div>
          <span className="brand-name">FinanceAI</span>
        </div>

        <div className="profile-section">
          <p className="sidebar-label">Profile</p>

          <div className="stat-card">
            <div className="stat-icon salary-icon"><TrendingUp size={14} /></div>
            <div className="stat-body">
              <span className="stat-label">Income</span>
              <span className="stat-value">{formatCurrency(currentStats.salary)}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon savings-icon"><PiggyBank size={14} /></div>
            <div className="stat-body">
              <span className="stat-label">Savings</span>
              <span className="stat-value">{formatCurrency(currentStats.currentSavings)}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon goal-icon"><Target size={14} /></div>
            <div className="stat-body">
              <span className="stat-label">Goal</span>
              <span className="stat-value goal-text">{currentStats.goals || '—'}</span>
            </div>
          </div>

          {hasProfile && (
            <div className="profile-badge">
              <span className="badge-dot" />
              Profile active
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <button className="new-chat-btn" onClick={() => { setMessages([WELCOME]); setInput(''); setPendingPdf(null); setThreadId(crypto.randomUUID()); }}>
            + New conversation
          </button>
          <p className="privacy-note">PII is redacted before reaching the AI model.</p>
        </div>
      </aside>

      {/* Chat */}
      <main className="chat-area">
        {false && (
          <div className="empty-state" style={{display:'none'}}>
            <div className="empty-icon"><TrendingUp size={34} /></div>
            <h1>Your personal finance analyst</h1>
            <p>Share your salary, savings, and goals — or upload a bank statement — and I'll help you build a plan.</p>
            <div className="chips">
              {["My salary is $5,000/month", "I want to save for a house", "Upload a bank statement"].map(s => (
                <button key={s} className="chip" onClick={() => {
                  if (s === "Upload a bank statement") fileInputRef.current?.click();
                  else setInput(s);
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`message-row ${m.role === 'user' ? 'user' : 'bot'}`}>
              {m.role !== 'user' && (
                <div className="avatar"><TrendingUp size={13} /></div>
              )}
              <div className={[
                'bubble',
                m.role === 'user' ? 'user-bubble' : 'bot-bubble',
                m.isError ? 'error-bubble' : '',
                m.isPdf ? 'pdf-bubble' : '',
              ].filter(Boolean).join(' ')}>
                <ErrorBoundary fallback={<p className="render-error">Could not render this message.</p>}>
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {m.content.replace(/\[CHART_DATA:.*?\]/gs, '')}
                    </ReactMarkdown>
                    {m.content.includes('[CHART_DATA:') && (
                      <ErrorBoundary fallback={<p className="render-error">Chart could not render.</p>}>
                        <FinancialChart rawData={m.content} />
                      </ErrorBoundary>
                    )}
                    {m.piiStats && Object.keys(m.piiStats.counts).length > 0 && (
                      <details className="pii-shield">
                        <summary>🔒 PII redacted before sending to AI — {Object.entries(m.piiStats.counts).map(([k, v]) => `${v} ${k}`).join(', ')}</summary>
                        <pre className="pii-preview">{m.piiStats.preview}…</pre>
                      </details>
                    )}
                  </div>
                </ErrorBoundary>
              </div>
            </div>
          ))}

          {isPdfLoading && (
            <div className="message-row bot">
              <div className="avatar"><TrendingUp size={13} /></div>
              <div className="bubble bot-bubble typing-bubble">
                <span className="dot" /><span className="dot" /><span className="dot" />
                <span className="typing-label">Reading your statement…</span>
              </div>
            </div>
          )}
          {isLoading && !isPdfLoading && (
            <div className="message-row bot">
              <div className="avatar"><TrendingUp size={13} /></div>
              <div className="bubble bot-bubble typing-bubble">
                <span className="dot" /><span className="dot" /><span className="dot" />
                <span className="typing-label">Analysing…</span>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {pendingPdf && (
          <div className="pdf-pill">
            <span>📄</span>
            <span className="pdf-pill-name">{pendingPdf.file.name}</span>
            <button onClick={() => setPendingPdf(null)}><X size={12} /></button>
          </div>
        )}

        <div className="input-bar">
          <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileSelect} style={{ display: 'none' }} />
          <button type="button" className="icon-btn" onClick={() => fileInputRef.current?.click()} disabled={anyLoading} title="Attach PDF">
            <Paperclip size={16} />
          </button>
          <input
            className="text-input"
            placeholder={pendingPdf ? 'Add a note, or just press send…' : 'Message your finance agent…'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={anyLoading}
          />
          <button
            className={`send-btn ${anyLoading ? 'sending' : ''}`}
            onClick={handleSubmit}
            disabled={anyLoading || (!input.trim() && !pendingPdf)}
          >
            {anyLoading ? <span className="spinner" /> : <Send size={15} />}
          </button>
        </div>
        <p className="input-hint">End-to-end: PII redacted on upload · data never stored</p>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FinanceApp />
    </ErrorBoundary>
  );
}