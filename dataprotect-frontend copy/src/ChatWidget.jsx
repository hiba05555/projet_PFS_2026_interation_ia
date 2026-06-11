import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
const API_URL = import.meta.env.VITE_API_URL || 'http://172.22.160.1:3000';
export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef = useRef(null);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    const q = input; setInput(''); setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const userStr = localStorage.getItem('user');
      const userId = userStr ? JSON.parse(userStr).id : 'anonymous';
      const res = await axios.post(`${API_URL}/api/chatbot/chat`,
        { query: q, userId, conversationId, userToken: token },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessages(prev => [...prev, { role: 'assistant', content: res.data.response }]);
      if (!conversationId) setConversationId(res.data.conversationId);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Erreur de connexion.' }]);
    }
    setLoading(false);
  };
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999 }}>
      {open && (
        <div style={{ width: 340, height: 480, background: '#0f0f14', border: '1px solid rgba(204,0,0,0.3)', borderRadius: 16, display: 'flex', flexDirection: 'column', marginBottom: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>Assistant ERP</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 18 }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {messages.length === 0 && <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>Posez une question sur l ERP...</div>}
            {messages.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                <div style={{ maxWidth: '80%', padding: '8px 12px', borderRadius: 10, background: m.role === 'user' ? 'rgba(204,0,0,0.8)' : 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 13 }}>{m.content}</div>
              </div>
            ))}
            {loading && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>...</div>}
            <div ref={messagesEndRef} />
          </div>
          <div style={{ padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: 8 }}>
            <input value={input} onChange={e => setInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && sendMessage()} placeholder="Votre question..." disabled={loading}
              style={{ flex: 1, padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none' }} />
            <button onClick={sendMessage} disabled={loading || !input.trim()}
              style={{ padding: '8px 14px', background: 'rgba(204,0,0,0.85)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 16 }}>➤</button>
          </div>
        </div>
      )}
      <button onClick={() => setOpen(!open)}
        style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(204,0,0,0.9)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(204,0,0,0.5)', marginLeft: 'auto' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
    </div>
  );
}