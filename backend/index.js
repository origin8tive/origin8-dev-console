require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const fs = require('fs');

const app = express();
const client = new Anthropic();

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:5173'];

// Security: only allow commands starting with these prefixes
const ALLOWED_COMMANDS = [
  'npm install', 'npm run', 'npm test', 'npm ci',
  'git status', 'git log', 'git diff',
  'ls', 'pwd', 'cat', 'echo'
];

const WORKSPACE = '/tmp/ai-workspace';

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Generate execution plan with Claude
app.post('/plan', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) {
    return res.status(400).json({ error: 'Invalid prompt (max 1000 chars)' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'You are an expert software development assistant. Create clear, actionable execution plans.',
      messages: [{
        role: 'user',
        content: `Create a detailed execution plan for this development task:\n\n"${prompt}"\n\nFormat as a numbered list covering:\n1. Files to create or modify\n2. Commands to run\n3. Dependencies needed\n4. Expected result`
      }]
    });
    res.json({ plan: message.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Execute task with Claude
app.post('/execute', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string' || prompt.length > 1000) {
    return res.status(400).json({ error: 'Invalid prompt (max 1000 chars)' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are an expert software development assistant. Execute tasks by providing code, explanations, and step-by-step guidance.',
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ output: message.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Write file — sandboxed to WORKSPACE
app.post('/write-file', (req, res) => {
  const { filePath, content } = req.body;
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Invalid filePath' });
  }

  const resolved = path.resolve(WORKSPACE, filePath);
  if (!resolved.startsWith(WORKSPACE + path.sep) && resolved !== WORKSPACE) {
    return res.status(403).json({ error: 'Path outside workspace is forbidden' });
  }

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content ?? '', 'utf8');
    res.json({ success: true, path: resolved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Read file — sandboxed to WORKSPACE
app.get('/read-file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  const resolved = path.resolve(WORKSPACE, filePath);
  if (!resolved.startsWith(WORKSPACE)) {
    return res.status(403).json({ error: 'Path outside workspace is forbidden' });
  }

  try {
    const content = fs.readFileSync(resolved, 'utf8');
    res.json({ content });
  } catch (e) {
    res.status(404).json({ error: 'File not found' });
  }
});

// List workspace files
app.get('/files', (_req, res) => {
  try {
    fs.mkdirSync(WORKSPACE, { recursive: true });
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries.flatMap(e => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : full.replace(WORKSPACE + '/', '');
      });
    };
    res.json({ files: walk(WORKSPACE) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Run whitelisted command
app.post('/run-command', (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing command' });
  }

  const trimmed = command.trim();
  const allowed = ALLOWED_COMMANDS.some(prefix => trimmed.startsWith(prefix));
  if (!allowed) {
    return res.status(403).json({
      error: `Command blocked. Allowed prefixes: ${ALLOWED_COMMANDS.join(', ')}`
    });
  }

  fs.mkdirSync(WORKSPACE, { recursive: true });
  exec(trimmed, { cwd: WORKSPACE, timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: err.message, stderr });
    res.json({ output: stdout, stderr });
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Origin8 Dev Console backend running on port ${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('WARNING: ANTHROPIC_API_KEY is not set — Claude calls will fail');
  }
});
