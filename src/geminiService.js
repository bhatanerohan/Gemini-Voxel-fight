// src/geminiService.js — Reusable Gemini long-context client

const ENDPOINT = '/gemini/chat/completions';
const MODELS = ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

/**
 * Extract JSON from a string that may contain markdown code fences or extra text.
 * Returns parsed object or null.
 */
function extractJSON(text) {
  if (!text) return null;

  // 1. Direct parse
  try { return JSON.parse(text); } catch (_) { /* continue */ }

  // 2. Markdown code block: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch (_) { /* continue */ }
  }

  // 3. First '{' to last '}'
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try { return JSON.parse(text.slice(first, last + 1)); } catch (_) { /* continue */ }
  }

  return null;
}

/**
 * Internal: call Gemini with model fallback. Returns { text, model } or null.
 */
async function callGemini(opts) {
  for (const model of MODELS) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.9,
          max_tokens: opts.maxTokens ?? 2000,
          messages: [
            { role: 'system', content: opts.systemPrompt },
            { role: 'user', content: opts.userMessage },
          ],
        }),
      });

      if (res.status === 401 || res.status === 403) {
        console.warn(`[geminiService] Auth error (${res.status}) — aborting`);
        return null;
      }

      if (!res.ok) {
        console.warn(`[geminiService] ${model} returned ${res.status}, trying next model`);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return { text, model };

      console.warn(`[geminiService] ${model} returned empty content, trying next model`);
    } catch (err) {
      if (err.name === 'AbortError') return null;
      console.warn(`[geminiService] ${model} failed:`, err.message);
    }
  }
  return null;
}

/**
 * Send a prompt to Gemini expecting structured JSON output.
 * Returns parsed JSON object or null on failure.
 * NEVER throws.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {number} [opts.temperature=0.9]
 * @param {number} [opts.maxTokens=2000]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<object|null>}
 */
export async function geminiJSON(opts) {
  try {
    const result = await callGemini(opts);
    if (!result) return null;
    const parsed = extractJSON(result.text);
    if (!parsed) {
      console.warn('[geminiService] Failed to parse JSON from response');
    }
    return parsed;
  } catch (err) {
    console.warn('[geminiService] geminiJSON unexpected error:', err.message);
    return null;
  }
}

/**
 * Send a prompt and get raw text back.
 * Returns string or null on failure.
 * NEVER throws.
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {number} [opts.temperature=0.9]
 * @param {number} [opts.maxTokens=2000]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string|null>}
 */
export async function geminiText(opts) {
  try {
    const result = await callGemini(opts);
    return result?.text ?? null;
  } catch (err) {
    console.warn('[geminiService] geminiText unexpected error:', err.message);
    return null;
  }
}
