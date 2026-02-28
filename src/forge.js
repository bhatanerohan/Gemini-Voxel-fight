import { setWeapon, setActiveWeaponVisuals } from './sandbox.js';
import { CODER_PROMPT } from './prompt.js';
import { playForgeOpen, playForgeComplete } from './audio.js';
import { validateWeaponCode } from './weaponValidator.js';
import { MatchMemory } from './matchMemory.js';
import { geminiText } from './geminiService.js';
import { generateWeaponVisuals } from './llama/weaponVisualsAgent.js';

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
      status.textContent = 'Forging weapon...';
      status.className = 'forge-loading';
      const coderInput = `## PLAYER WEAPON REQUEST:\n"${prompt}"\n\nImplement a weapon that matches this request. Infer missing details if needed. Output ONLY the function body code.`;
      const generationStart = performance.now();
      const code = await geminiText({
        systemPrompt: CODER_PROMPT,
        userMessage: coderInput,
        temperature: 0.7,
        maxTokens: 8192,
      });
      if (!code) throw new Error('Gemini returned an empty response.');
      const generationMs = Math.round(performance.now() - generationStart);

      status.textContent = 'Compiling...';
      status.className = 'forge-loading';
      const cleanCode = code.replace(/^```(?:javascript|js)?\n?/i, '').replace(/\n?```$/i, '').trim();
      console.log(`Weapon generation time: ${generationMs} ms`);
      console.log('Generated weapon code:\n', cleanCode);

      const validation = validateWeaponCode(cleanCode);
      if (!validation.valid) {
        const msg = 'Weapon code blocked:\n• ' + validation.errors.join('\n• ');
        console.warn(msg);
        errEl.textContent = msg;
        status.textContent = 'Weapon rejected — unsafe code detected';
        status.className = 'forge-fail';
        return;
      }

      const fn = new Function('ctx', cleanCode);
      setWeapon(fn, prompt, cleanCode);
      MatchMemory.recordWeaponForge(prompt);

      // Generate weapon visuals in background (non-blocking)
      generateWeaponVisuals(prompt).then(visuals => {
        if (visuals) setActiveWeaponVisuals(visuals);
      });
      status.textContent = 'Weapon ready!';
      status.className = 'forge-success';
      playForgeComplete();
      setTimeout(closeForge, 700);
    } catch (err) {
      console.error('Forge error:', err);
      errEl.textContent = err.message;
      status.textContent = 'Generation failed — try again';
      status.className = 'forge-fail';
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

