import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_TARGET = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_TTS_TARGET = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent';
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

const TTS_VOICES = new Set([
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda',
  'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus',
  'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima',
]);

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

function pcm16ToWavBuffer(pcmBuffer, sampleRate = 24000, channels = 1) {
  const bytesPerSample = 2;
  const byteRate = sampleRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;
  const dataSize = pcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmBuffer]);
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

app.post('/gemini/tts', rateLimit, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: 'GEMINI_API_KEY not configured on server' } });
  }

  let ttsPayload = null;
  const hasGeminiPayload = Array.isArray(req.body?.contents);

  if (hasGeminiPayload) {
    ttsPayload = req.body;
    ttsPayload.generationConfig = ttsPayload.generationConfig || {};
    ttsPayload.generationConfig.responseModalities = ['AUDIO'];
    ttsPayload.generationConfig.speechConfig = ttsPayload.generationConfig.speechConfig || {};
    ttsPayload.generationConfig.speechConfig.voiceConfig = ttsPayload.generationConfig.speechConfig.voiceConfig || {};
    ttsPayload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig =
      ttsPayload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig || {};

    const voiceRaw = safeString(ttsPayload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).trim();
    ttsPayload.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName =
      TTS_VOICES.has(voiceRaw) ? voiceRaw : 'Kore';
  } else {
    const text = safeString(req.body?.text).trim();
    if (!text) {
      return res.status(400).json({ error: { message: 'Invalid request: text is required' } });
    }
    if (text.length > 320) {
      return res.status(400).json({ error: { message: 'Text too long (max 320 chars).' } });
    }

    const voiceNameRaw = safeString(req.body?.voiceName).trim();
    const voiceName = TTS_VOICES.has(voiceNameRaw) ? voiceNameRaw : 'Kore';
    const mood = safeString(req.body?.mood, 'epic').toLowerCase();
    const pace = Math.max(0.75, Math.min(1.3, Number(req.body?.rate) || 1));

    const moodStyle = ({
      epic: 'Narrate with cinematic weight and confidence.',
      ominous: 'Narrate in a tense, ominous tone.',
      triumphant: 'Narrate with energetic triumph and momentum.',
      desperate: 'Narrate with urgency and strain.',
      quiet: 'Narrate softly but clearly.',
    })[mood] || 'Narrate clearly with dramatic pacing.';

    const paceStyle = pace > 1.08
      ? 'Keep delivery brisk.'
      : pace < 0.92
        ? 'Keep delivery measured and deliberate.'
        : 'Keep delivery natural.';

    const ttsPrompt = `${moodStyle} ${paceStyle} Speak this exact line: "${text}"`;
    ttsPayload = {
      contents: [{
        parts: [{ text: ttsPrompt }],
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    };
  }

  try {
    const upstream = await fetch(GEMINI_TTS_TARGET, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY,
      },
      body: JSON.stringify(ttsPayload),
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({
        error: { message: `Gemini TTS failed (${upstream.status}): ${body.slice(0, 220)}` },
      });
    }

    const ttsResult = await upstream.json().catch(() => null);
    const parts = ttsResult?.candidates?.[0]?.content?.parts;
    const audioPart = Array.isArray(parts)
      ? parts.find(p => typeof p?.inlineData?.data === 'string' && p.inlineData.data)
      : null;
    const base64 = audioPart?.inlineData?.data || '';
    const pcm = decodeBase64ToBuffer(base64);
    if (!pcm || !pcm.length) {
      return res.status(502).json({ error: { message: 'Gemini TTS returned empty audio.' } });
    }

    const wav = pcm16ToWavBuffer(pcm, 24000, 1);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(wav);
  } catch (err) {
    console.error('Gemini TTS proxy error:', err?.message || err);
    return res.status(502).json({ error: { message: 'Failed to reach Gemini TTS API' } });
  }
});

app.post('/gemini-tts/models/:model\\:generateContent', rateLimit, async (req, res) => {
  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: { message: 'GEMINI_API_KEY not configured on server' } });
  }

  const { model } = req.params;
  if (!model || !model.startsWith('gemini-2.5')) {
    return res.status(400).json({ error: { message: `Model not allowed: ${model}` } });
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify(req.body),
      }
    );

    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(value);
    }
  } catch (err) {
    console.error('TTS proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: { message: 'Failed to reach Gemini TTS API' } });
    }
  }
});

// Serve static production build
app.use(express.static(join(__dirname, 'dist')));

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
