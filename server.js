import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TARGET = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const LLAMA_CLOUD_API_KEY = process.env.LLAMA_CLOUD_API_KEY || '';
const LLAMAPARSE_UPLOAD_URL = 'https://api.cloud.llamaindex.ai/api/v2/parse/upload';
const LLAMAPARSE_JOB_URL = 'https://api.cloud.llamaindex.ai/api/v2/parse';
const MAX_LLAMA_UPLOAD_BYTES = 10 * 1024 * 1024;

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function decodeBase64ToBuffer(base64) {
  if (typeof base64 !== 'string' || !base64.trim()) return null;
  try {
    return Buffer.from(base64, 'base64');
  } catch (_) {
    return null;
  }
}

function extractParseText(payload) {
  const candidates = [
    payload?.text,
    payload?.markdown,
    payload?.result?.text,
    payload?.result?.markdown,
    payload?.job?.text,
    payload?.job?.markdown,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

async function pollLlamaParseJob(jobId) {
  const maxAttempts = 24;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${LLAMAPARSE_JOB_URL}/${encodeURIComponent(jobId)}?expand=text,markdown`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}`,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LlamaParse job request failed (${res.status}): ${body.slice(0, 180)}`);
    }

    const payload = await res.json().catch(() => ({}));
    const status = safeString(payload?.status || payload?.job?.status).toLowerCase();
    const text = extractParseText(payload);
    if (text) return { status: status || 'success', text };
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      const message = safeString(payload?.error_message || payload?.message, 'LlamaParse job failed.');
      throw new Error(message);
    }

    await sleep(1200);
  }

  throw new Error('LlamaParse timed out. Try again with a smaller file.');
}

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.post('/llamaparse/parse', rateLimit, express.json({ limit: '20mb' }), async (req, res) => {
  if (!LLAMA_CLOUD_API_KEY) {
    return res.status(503).json({ error: { message: 'LLAMA_CLOUD_API_KEY not configured on server' } });
  }

  const fileName = safeString(req.body?.fileName, 'upload.pdf').slice(0, 180) || 'upload.pdf';
  const mimeType = safeString(req.body?.mimeType, 'application/octet-stream').slice(0, 80) || 'application/octet-stream';
  const bytes = decodeBase64ToBuffer(req.body?.base64);
  if (!bytes || bytes.length === 0) {
    return res.status(400).json({ error: { message: 'Invalid upload payload.' } });
  }
  if (bytes.length > MAX_LLAMA_UPLOAD_BYTES) {
    return res.status(413).json({ error: { message: 'File too large (max 10 MB).' } });
  }

  try {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mimeType }), fileName);

    const uploadRes = await fetch(LLAMAPARSE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LLAMA_CLOUD_API_KEY}`,
      },
      body: form,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      return res.status(uploadRes.status).json({
        error: { message: `LlamaParse upload failed (${uploadRes.status}): ${text.slice(0, 220)}` },
      });
    }

    const uploadPayload = await uploadRes.json().catch(() => ({}));
    const instantText = extractParseText(uploadPayload);
    if (instantText) {
      return res.json({
        text: instantText,
        source: 'llamaparse-v2',
      });
    }

    const jobId = safeString(uploadPayload?.id || uploadPayload?.job_id || uploadPayload?.job?.id);
    if (!jobId) {
      return res.status(502).json({ error: { message: 'LlamaParse upload succeeded but returned no job ID.' } });
    }

    const result = await pollLlamaParseJob(jobId);
    return res.json({
      text: result.text,
      status: result.status,
      jobId,
      source: 'llamaparse-v2',
    });
  } catch (err) {
    console.error('LlamaParse proxy error:', err?.message || err);
    return res.status(502).json({ error: { message: err?.message || 'Failed to reach LlamaParse API' } });
  }
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
