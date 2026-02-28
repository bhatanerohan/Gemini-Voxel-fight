import { setWeapon } from './sandbox.js';
import { CODER_PROMPT } from './prompt.js';
import { playForgeOpen, playForgeComplete } from './audio.js';
import { validateWeaponCode } from './weaponValidator.js';

const GEMINI_CHAT_COMPLETIONS_PATH = '/gemini/chat/completions';
const GEMINI_MODELS = ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash'];

let forgeOpen = false;
let onOpenCb = null;
let onCloseCb = null;

export function isForgeOpen() { return forgeOpen; }

export function initForge(callbacks = {}) {
  onOpenCb = callbacks.onOpen;
  onCloseCb = callbacks.onClose;

  const overlay = document.getElementById('forge-overlay');
  const input = document.getElementById('forge-input');
  const btn = document.getElementById('forge-btn');
  const status = document.getElementById('forge-status');
  const errEl = document.getElementById('forge-error');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeForge();
  });

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doForge(); }
    if (e.key === 'Escape') closeForge();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  btn.addEventListener('click', doForge);

  async function doForge() {
    const prompt = input.value.trim();
    if (!prompt) return;

    btn.disabled = true;
    errEl.textContent = '';

    try {
      status.innerHTML = '<span class="forge-loading">Forging weapon<span class="dots"></span></span>';
      const coderInput = `## PLAYER WEAPON REQUEST:\n"${prompt}"\n\nImplement a weapon that matches this request. Infer missing details if needed. Output ONLY the function body code.`;
      const generationStart = performance.now();
      const { code, model } = await callLLM(CODER_PROMPT, coderInput);
      const generationMs = Math.round(performance.now() - generationStart);

      status.innerHTML = '<span class="forge-loading">Compiling<span class="dots"></span></span>';
      const cleanCode = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();
      console.log('Gemini model used:', model, `| generation time: ${generationMs} ms`);
      console.log('Generated weapon code:\n', cleanCode);

      const validation = validateWeaponCode(cleanCode);
      if (!validation.valid) {
        const msg = 'Weapon code blocked:\n• ' + validation.errors.join('\n• ');
        console.warn(msg);
        errEl.textContent = msg;
        status.innerHTML = '<span class="forge-fail">Weapon rejected — unsafe code detected</span>';
        return;
      }

      const fn = new Function('ctx', cleanCode);
      setWeapon(fn, prompt, cleanCode);
      status.innerHTML = '<span class="forge-success">⚡ Weapon ready!</span>';
      playForgeComplete();
      setTimeout(closeForge, 700);
    } catch (err) {
      console.error('Forge error:', err);
      errEl.textContent = err.message;
      status.innerHTML = '<span class="forge-fail">Generation failed — try again</span>';
    } finally {
      btn.disabled = false;
    }
  }
}

export function openForge() {
  forgeOpen = true;
  playForgeOpen();
  document.getElementById('forge-overlay').classList.add('open');
  document.getElementById('forge-input').focus();
  document.getElementById('forge-error').textContent = '';
  document.getElementById('forge-status').textContent = '';
  onOpenCb?.();
}

export function closeForge() {
  forgeOpen = false;
  document.getElementById('forge-overlay').classList.remove('open');
  onCloseCb?.();
}

function extractMessageText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  throw new Error('Gemini returned an empty response.');
}

async function requestCompletion(systemPrompt, userMessage, model) {
  const res = await fetch(GEMINI_CHAT_COMPLETIONS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err.error?.message || `Gemini API error ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  return {
    code: extractMessageText(data),
    model,
  };
}

async function callLLM(systemPrompt, userMessage, models = GEMINI_MODELS) {
  let lastError = null;
  for (const model of models) {
    try {
      return await requestCompletion(systemPrompt, userMessage, model);
    } catch (err) {
      lastError = err;
      if (err?.status === 401 || err?.status === 403) break;
    }
  }

  throw lastError || new Error('Gemini request failed.');
}
