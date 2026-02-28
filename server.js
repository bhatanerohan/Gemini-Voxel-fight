import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TARGET = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// Allowed origins (restrict in production)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 20; // max requests per window

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return next();
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: { message: 'Too many requests. Try again later.' } });
  }
  next();
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS);

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Body parser with size limit
app.use(express.json({ limit: '10kb' }));

// Proxy endpoint with rate limiting and validation
app.post('/gemini/chat/completions', rateLimit, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: 'GEMINI_API_KEY not configured on server' } });
  }

  // Validate request body structure
  const { model, messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'Invalid request: messages array required' } });
  }
  if (messages.length > 10) {
    return res.status(400).json({ error: { message: 'Too many messages (max 10)' } });
  }

  // Only allow expected models
  const allowedModels = ['gemini-3', 'gemini-2.5', 'gemini-2.0', 'gemini-1.5'];
  if (model && !allowedModels.some(m => model.startsWith(m))) {
    return res.status(400).json({ error: { message: `Model not allowed: ${model}` } });
  }

  try {
    const upstream = await fetch(GEMINI_TARGET, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify(req.body),
    });

    res.status(upstream.status);

    // Forward content-type header
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    // Stream the response back
    const reader = upstream.body.getReader();
    const push = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        res.write(value);
      }
    };
    await push();
  } catch (err) {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: 'Failed to reach Gemini API' } });
    }
  }
});

// Serve static production build
app.use(express.static(join(__dirname, 'dist')));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
