import React, { useState, useRef, useEffect } from 'react';

const API = 'http://localhost:5000';

const logColor = (type) =>
  ({ info: '#60a5fa', success: '#34d399', error: '#f87171', output: '#e2e8f0' }[type] ?? '#e2e8f0');

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [plan, setPlan]   = useState(null);
  const [logs, setLogs]   = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent]   = useState('');
  const [phase, setPhase]   = useState('idle');
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef(null);

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { msg, type, time }]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handlePlan = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setPlan(null);
    setLogs([]);
    setFiles([]);
    setSelectedFile(null);
    setPhase('planning');
    addLog('Sending task to Claude for planning…', 'info');

    try {
      const res  = await fetch(`${API}/plan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlan(data.plan);
      addLog('Plan ready — review and click Execute when ready.', 'success');
      setPhase('planned');
    } catch (e) {
      addLog('Planning failed: ' + e.message, 'error');
      setPhase('idle');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    setPhase('executing');
    addLog('Executing task with Claude…', 'info');

    try {
      const res  = await fetch(`${API}/execute`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addLog(data.output, 'output');
      addLog('Execution complete.', 'success');
      setPhase('done');
      await refreshFiles();
    } catch (e) {
      addLog('Execution failed: ' + e.message, 'error');
      setPhase('planned');
    } finally {
      setLoading(false);
    }
  };

  const refreshFiles = async () => {
    try {
      const res  = await fetch(`${API}/files`);
      const data = await res.json();
      setFiles(data.files ?? []);
    } catch (_) {}
  };

  const openFile = async (filePath) => {
    setSelectedFile(filePath);
    try {
      const res  = await fetch(`${API}/read-file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      setFileContent(data.content ?? '');
    } catch (e) {
      setFileContent('Error reading file: ' + e.message);
    }
  };

  const reset = () => {
    setPrompt(''); setPlan(null); setLogs([]); setFiles([]);
    setSelectedFile(null); setFileContent(''); setPhase('idle');
  };

  return (
    <div style={s.page}>
      {/* ── Header ── */}
      <div style={s.header}>
        <span style={s.headerTitle}>🤖 Origin8 Dev Console</span>
        <span style={s.badge}>Claude claude-sonnet-4-6</span>
        <span style={{ ...s.badge, background: phaseColor(phase) }}>{phase}</span>
      </div>

      {/* ── Prompt input ── */}
      <div style={s.card}>
        <div style={s.cardLabel}>📝 Task</div>
        <textarea
          style={s.textarea}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe your development task… e.g. 'Create a React login form with email and password validation'"
          rows={4}
        />
        <div style={s.row}>
          <Btn label={loading && phase === 'planning' ? '⏳ Planning…' : '🧠 Plan Task'}
              disabled={loading || !prompt.trim()}
              color="#6366f1" onClick={handlePlan} />
          {(phase === 'planned' || phase === 'done') && (
            <Btn label={loading && phase === 'executing' ? '⏳ Executing…' : '▶ Execute'}
                disabled={loading} color="#10b981" onClick={handleExecute} />
          )}
          <Btn label="↩ Reset" color="#374151" onClick={reset} />
        </div>
      </div>

      {/* ── Two-column: Plan + Logs ── */}
      <div style={s.grid2}>
        {/* Task Planner */}
        <div style={s.card}>
          <div style={s.cardLabel}>🧠 Task Planner</div>
          {plan
            ? <pre style={s.pre}>{plan}</pre>
            : <Empty text={'Plan will appear after you click “Plan Task”.'} />
          }
        </div>

        {/* Logs */}
        <div style={s.card}>
          <div style={s.cardLabel}>📜 Execution Logs</div>
          <div style={s.logsBox}>
            {logs.length === 0
              ? <Empty text="No logs yet." />
              : logs.map((l, i) => (
                <div key={i} style={{ color: logColor(l.type), fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#64748b' }}>[{l.time}]</span>{' '}
                  <span style={{ whiteSpace: 'pre-wrap' }}>{l.msg}</span>
                </div>
              ))
            }
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>

      {/* ── File Viewer ── */}
      <div style={s.card}>
        <div style={{ ...s.row, alignItems: 'center', marginBottom: 12 }}>
          <div style={s.cardLabel}>📁 Workspace Files</div>
          <Btn label="⟳ Refresh" color="#334155" onClick={refreshFiles} />
        </div>
        {files.length === 0
          ? <Empty text="No workspace files yet. Files written during execution appear here." />
          : (
            <div style={s.fileLayout}>
              {/* File list */}
              <div style={s.fileList}>
                {files.map(f => (
                  <div key={f}
                    onClick={() => openFile(f)}
                    style={{ ...s.fileItem, background: selectedFile === f ? '#1e40af' : '#1e293b' }}>
                    {f}
                  </div>
                ))}
              </div>
              {/* File content */}
              <pre style={s.fileContent}>
                {selectedFile ? fileContent : 'Select a file to view its content.'}
              </pre>
            </div>
          )
        }
      </div>
    </div>
  );
}

function Btn({ label, color, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#1e293b' : color,
        color: disabled ? '#475569' : '#fff',
        border: 'none', borderRadius: 8,
        padding: '9px 18px', fontSize: 13,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'opacity .15s',
      }}>
      {label}
    </button>
  );
}

function Empty({ text }) {
  return <p style={{ color: '#475569', fontStyle: 'italic', fontSize: 13 }}>{text}</p>;
}

const phaseColor = (p) =>
  ({ idle: '#334155', planning: '#854d0e', planned: '#1e40af', executing: '#065f46', done: '#166534' }[p] ?? '#334155');

const s = {
  page:        { maxWidth: 1140, margin: '0 auto', padding: 24, fontFamily: '"Fira Code", monospace, sans-serif', background: '#0f172a', minHeight: '100vh', color: '#e2e8f0' },
  header:      { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  headerTitle: { fontSize: 24, fontWeight: 700, color: '#f1f5f9', flex: 1 },
  badge:       { background: '#1e293b', color: '#94a3b8', padding: '4px 12px', borderRadius: 20, fontSize: 12, border: '1px solid #334155' },
  card:        { background: '#1e293b', borderRadius: 12, padding: 20, marginBottom: 20, border: '1px solid #334155' },
  cardLabel:   { fontSize: 13, color: '#94a3b8', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 },
  textarea:    { width: '100%', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 14, resize: 'vertical', fontFamily: 'inherit' },
  row:         { display: 'flex', gap: 10, marginTop: 12 },
  grid2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 },
  pre:         { background: '#0f172a', padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto', margin: 0, color: '#cbd5e1' },
  logsBox:     { background: '#0f172a', padding: 12, borderRadius: 8, minHeight: 120, maxHeight: 320, overflow: 'auto' },
  fileLayout:  { display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16 },
  fileList:    { display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', maxHeight: 280 },
  fileItem:    { padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#93c5fd', wordBreak: 'break-all' },
  fileContent: { background: '#0f172a', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 280, margin: 0, color: '#cbd5e1', whiteSpace: 'pre-wrap' },
};
