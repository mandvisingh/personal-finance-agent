import React, { useState } from 'react';
import { Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function App() {
  const [messages, setMessages] = useState<{role: string, content: string}[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

const handleSubmit = async (e: React.FormEvent) => {
  setIsLoading(true);
  e.preventDefault();
  if (!input.trim()) return;

  // 1."user" and "assistant" as the roles
  const userMsg = { role: 'user', content: input };
  const updatedMessages = [...messages, userMsg];
  
  setMessages(prev => [...prev, userMsg]);
  setInput('');

  try {
    const response = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        // 2. Map roles
        messages: updatedMessages.map(m => ({
          role: m.role === 'bot' ? 'assistant' : m.role,
          content: m.content || ''
        }))
      }),
    });

    const data = await response.json();
    
    if (data.text) {
      setMessages(prev => [...prev, { role: 'bot', content: data.text }]);
    }
  } catch (error) {
    console.error('Fetch error:', error);
  } finally {
    setIsLoading(false);
  }
};

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      backgroundColor: '#000', 
      color: '#fff', 
      fontFamily: 'sans-serif' 
    }}>
      
      {messages.length === 0 && (
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          fontSize: '24px', 
          fontWeight: 'bold',
          opacity: 0.8
        }}>
          Your Personal Finance Agent
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ 
              marginBottom: '15px', 
              textAlign: m.role === 'user' ? 'right' : 'left' 
            }}>
              <div style={{ 
  display: 'inline-block', 
  padding: '12px 18px', 
  borderRadius: '15px', 
  backgroundColor: m.role === 'user' ? '#10b981' : '#1c1c1e',
  fontSize: '14px',
  textAlign: 'left',
  maxWidth: '90%',
  lineHeight: '1.6'
}}>
  <div className="markdown-content">
    <ReactMarkdown>
      {m.content}
    </ReactMarkdown>
  </div>
</div>
            </div>
          ))}
          {isLoading && (
  <div style={{ textAlign: 'left', marginBottom: '15px' }}>
    <span style={{ 
      display: 'inline-block', 
      padding: '10px 16px', 
      borderRadius: '15px', 
      backgroundColor: '#27272a',
      fontSize: '12px',
      color: '#a1a1aa'
    }}>
      Agent is analyzing...
    </span>
  </div>
)}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ 
        padding: '20px', 
        borderTop: '1px solid #222', 
        display: 'flex', 
        justifyContent: 'center',
        backgroundColor: '#000'
      }}>
        <div style={{ 
          position: 'relative', 
          width: '100%', 
          maxWidth: '600px',
          display: 'flex',
          gap: '10px'
        }}>
          <input
            style={{ 
              flex: 1, 
              padding: '12px 20px', 
              borderRadius: '25px', 
              border: '1px solid #444', 
              backgroundColor: '#111', 
              color: '#fff',
              outline: 'none'
            }}
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" style={{ 
            backgroundColor: '#fff', 
            border: 'none', 
            borderRadius: '50%', 
            width: '40px', 
            height: '40px', 
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Send size={18} color="#000" />
          </button>
        </div>
      </form>
    </div>
  );
}