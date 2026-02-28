import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TARGET = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

// CORS for dev mode
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// Proxy endpoint
app.post('/gemini/chat/completions', async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: 'GEMINI_API_KEY not configured on server' } });
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
