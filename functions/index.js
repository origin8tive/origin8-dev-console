const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

const ALLOWED_COMMANDS = [
  'npm install', 'npm run', 'npm test', 'npm ci',
  'git status', 'git log', 'git diff',
  'ls', 'pwd', 'cat', 'echo'
];
const WORKSPACE = '/tmp/ai-workspace';

function buildApp(apiKey) {
  const { default: Anthropic } = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '1mb' }));

  // Mount routes at both / and /api so Firebase rewrite (/api/**) and
  // local direct calls (http://localhost:5000/plan) both work
  const router = express.Router();

  router.get('/health', (_req, res) => res.json({ status: 'ok' }));

  router.post('/plan', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000)
      return res.status(400).json({ error: 'Invalid prompt (max 1000 chars)' });

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

  router.post('/execute', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.length > 1000)
      return res.status(400).json({ error: 'Invalid prompt (max 1000 chars)' });

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

  router.post('/write-file', (req, res) => {
    const { filePath, content } = req.body;
    if (!filePath || typeof filePath !== 'string')
      return res.status(400).json({ error: 'Invalid filePath' });

    const resolved = path.resolve(WORKSPACE, filePath);
    if (!resolved.startsWith(WORKSPACE + path.sep) && resolved !== WORKSPACE)
      return res.status(403).json({ error: 'Path outside workspace is forbidden' });

    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content ?? '', 'utf8');
      res.json({ success: true, path: resolved });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/read-file', (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'Missing path' });
    const resolved = path.resolve(WORKSPACE, filePath);
    if (!resolved.startsWith(WORKSPACE))
      return res.status(403).json({ error: 'Path outside workspace is forbidden' });
    try {
      res.json({ content: fs.readFileSync(resolved, 'utf8') });
    } catch {
      res.status(404).json({ error: 'File not found' });
    }
  });

  router.get('/files', (_req, res) => {
    try {
      fs.mkdirSync(WORKSPACE, { recursive: true });
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        return entries.flatMap(e => {
          const full = path.join(dir, e.name);
          return e.isDirectory() ? walk(full) : [full.replace(WORKSPACE + '/', '')];
        });
      };
      res.json({ files: walk(WORKSPACE) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/run-command', (req, res) => {
    const { command } = req.body;
    if (!command || typeof command !== 'string')
      return res.status(400).json({ error: 'Missing command' });

    const trimmed = command.trim();
    const allowed = ALLOWED_COMMANDS.some(p => trimmed.startsWith(p));
    if (!allowed)
      return res.status(403).json({ error: `Command blocked. Allowed: ${ALLOWED_COMMANDS.join(', ')}` });

    fs.mkdirSync(WORKSPACE, { recursive: true });
    exec(trimmed, { cwd: WORKSPACE, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: err.message, stderr });
      res.json({ output: stdout, stderr });
    });
  });

  // Mount at both root and /api (for Firebase Hosting rewrite)
  app.use('/', router);
  app.use('/api', router);

  return app;
}

exports.api = onRequest(
  { secrets: [anthropicKey], region: 'us-central1', memory: '512MiB', timeoutSeconds: 120 },
  (req, res) => {
    const app = buildApp(anthropicKey.value());
    return app(req, res);
  }
);
