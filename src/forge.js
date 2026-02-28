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
const MAX_FORGE_ATTEMPTS = 4;
const MAX_CODE_CHARS_TARGET = 9500;

export function isForgeOpen() { return forgeOpen; }

function stripCodeFences(code = '') {
  return String(code)
    .replace(/```(?:javascript|js)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function unwrapGeneratedFunctionBody(code = '') {
  const src = String(code).trim();
  const patterns = [
    /^\s*function\s+[A-Za-z_$][\w$]*\s*\(\s*ctx\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/i,
    /^\s*function\s*\(\s*ctx\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/i,
    /^\s*async\s+function\s+[A-Za-z_$][\w$]*\s*\(\s*ctx\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/i,
    /^\s*async\s+function\s*\(\s*ctx\s*\)\s*\{([\s\S]*)\}\s*;?\s*$/i,
    /^\s*\(\s*ctx\s*\)\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/i,
    /^\s*ctx\s*=>\s*\{([\s\S]*)\}\s*;?\s*$/i,
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (m && m[1]) return m[1].trim();
  }
  if (/^\s*export\s+default\s+/i.test(src)) {
    return unwrapGeneratedFunctionBody(src.replace(/^\s*export\s+default\s+/i, ''));
  }
  return '';
}

function buildWeaponCodeCandidates(rawCode = '') {
  const out = [];
  const seen = new Set();
  const push = (candidate) => {
    const val = String(candidate || '').trim();
    if (!val || seen.has(val)) return;
    seen.add(val);
    out.push(val);
  };

  const stripped = stripCodeFences(rawCode);
  push(stripped);
  const unwrapped = unwrapGeneratedFunctionBody(stripped);
  push(unwrapped);

  const lines = stripped.split('\n');
  const firstCodeLine = lines.findIndex((line) => /^(const|let|var|if|for|while|switch|ctx\.|return|\{)/.test(line.trim()));
  if (firstCodeLine > 0) {
    const tail = lines.slice(firstCodeLine).join('\n').trim();
    push(tail);
    push(unwrapGeneratedFunctionBody(tail));
  }

  return out;
}

function validateAndCompile(code = '') {
  const validation = validateWeaponCode(code);
  if (!validation.valid) {
    return { ok: false, errors: validation.errors };
  }

  try {
    new Function('ctx', code);
  } catch (err) {
    return { ok: false, errors: [`Syntax error: ${err?.message || 'unknown compile error'}`] };
  }

  return { ok: true, errors: [] };
}

function hashPrompt(prompt = '') {
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function choosePalette(prompt = '') {
  const palettes = [
    ['#66ccff', '#1f7fc7'],
    ['#ff7f50', '#c4432c'],
    ['#a4ff7a', '#49a63b'],
    ['#f9a8ff', '#a946b3'],
    ['#ffd866', '#b58a20'],
    ['#7cf8d6', '#2e9f88'],
  ];
  return palettes[hashPrompt(prompt) % palettes.length];
}

function buildFallbackWeaponCode(prompt = '') {
  const p = String(prompt || '').toLowerCase();
  const [c1, c2] = choosePalette(prompt);
  const isBeam = /(beam|laser|ray|lightning|freeze|ice)/.test(p);
  const isCone = /(shotgun|spread|cone|fan|blast)/.test(p);
  const isZone = /(black hole|gravity|vortex|tornado|pull|singularity)/.test(p);
  const isExplosive = /(rocket|grenade|bomb|missile|explode|mortar|cannon)/.test(p);

  if (isBeam) {
    return `
const origin = ctx.player.getShootOrigin();
const dir = ctx.player.getDirection().clone().normalize();
const hits = ctx.findLineHits(origin, dir, { range: 34, width: 0.9, max: 4, sortBy: 'along' });
let end = origin.clone().add(dir.clone().multiplyScalar(34));
if (hits.length > 0) end = hits[0].point.clone();
ctx.spawnBeam(origin, end, { color: '${c1}', width: 0.2, life: 0.12, opacity: 0.9 });
for (const h of hits) {
  ctx.damageEnemy(h.enemy, { damage: 20 });
}
if (hits.length > 0) {
  ctx.spawnImpactBurst(end, { color: '${c1}', count: 16, speed: 8, lifetime: 0.28, size: 3.2, light: true, lightIntensity: 2.4 });
}
`.trim();
  }

  if (isZone) {
    return `
const origin = ctx.player.getShootOrigin();
const dir = ctx.player.getDirection().clone().normalize();
const center = origin.clone().add(dir.clone().multiplyScalar(10));
ctx.spawnZone({
  center,
  radius: 4.4,
  duration: 2.3,
  tick: 0.08,
  visual: { color: '${c1}', opacity: 0.46, thickness: 0.11 },
  effects: {
    damage: { damage: 4, falloff: 'linear' },
    radialForce: { mode: 'inward', strength: 34, lift: 1.2, falloff: 'linear' },
    damp: { multiplier: 0.86, includeY: false }
  }
});
ctx.spawnImpactBurst(center, { color: '${c2}', count: 14, speed: 6, lifetime: 0.3, size: 3, light: true, lightIntensity: 2.2 });
`.trim();
  }

  if (isCone) {
    return `
const origin = ctx.player.getShootOrigin();
const dir = ctx.player.getDirection().clone().normalize();
ctx.spawnTelegraphCone(origin, dir, { range: 12, angleDeg: 20, color: '${c1}', life: 0.08, opacity: 0.34 });
ctx.damageCone(origin, dir, { range: 12, angleDeg: 20, damage: 10, falloff: 'linear', max: 8 });
ctx.applyForceCone(origin, dir, { range: 12, angleDeg: 20, strength: 10, lift: 1.8, falloff: 'linear', max: 8 });
ctx.spawnPulseRing(origin, { radius: 0.9, color: '${c2}', life: 0.09, width: 0.2, opacity: 0.3 });
`.trim();
  }

  if (isExplosive) {
    return `
const origin = ctx.player.getShootOrigin();
const dir = ctx.player.getDirection().clone().normalize();
const mesh = new ctx.THREE.Mesh(
  new ctx.THREE.SphereGeometry(0.2, 10, 10),
  new ctx.THREE.MeshStandardMaterial({ color: '${c1}', emissive: '${c2}', emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.15 })
);
ctx.spawn(mesh, {
  position: origin,
  velocity: dir.multiplyScalar(48),
  gravity: 18,
  radius: 0.5,
  bounce: 0.15,
  lifetime: 2.2,
  onUpdate: (dt, elapsed, ent) => {
    const p = ent.getPosition();
    const enemies = ctx.getEnemies();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.hp <= 0) continue;
      if (e.distanceTo(p) < 1.1) {
        ctx.explode(p, { radius: 4, damage: 22, force: 26, color: '${c1}', particles: 32, lightIntensity: 3.6 });
        return false;
      }
    }
    if (p.y < 0.45) {
      ctx.explode(p, { radius: 4, damage: 22, force: 26, color: '${c1}', particles: 32, lightIntensity: 3.6 });
      return false;
    }
    return true;
  }
});
`.trim();
  }

  return `
const origin = ctx.player.getShootOrigin();
const dir = ctx.player.getDirection().clone().normalize();
const mesh = new ctx.THREE.Mesh(
  new ctx.THREE.SphereGeometry(0.16, 8, 8),
  new ctx.THREE.MeshStandardMaterial({ color: '${c1}', emissive: '${c2}', emissiveIntensity: 1.2, roughness: 0.2, metalness: 0.1 })
);
ctx.spawn(mesh, {
  position: origin,
  velocity: dir.multiplyScalar(70),
  gravity: 0,
  radius: 0.38,
  bounce: 0,
  lifetime: 2.1,
  onUpdate: (dt, elapsed, ent) => {
    const p = ent.getPosition();
    const enemies = ctx.getEnemies();
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.hp <= 0) continue;
      if (e.distanceTo(p) < 0.95) {
        ctx.damageEnemy(e, { damage: 18 });
        ctx.applyForceToEnemy(e, { direction: dir, strength: 12, lift: 2.4 });
        ctx.spawnImpactBurst(p, { color: '${c1}', count: 18, speed: 8, lifetime: 0.3, size: 3.2, light: true, lightIntensity: 2.2 });
        return false;
      }
    }
    return true;
  }
});
`.trim();
}

function buildForgeCoderInput(prompt, attempt, previousErrors = []) {
  const base = `## PLAYER WEAPON REQUEST:
"${prompt}"

Implement a weapon that matches this request. Infer missing details if needed. Output ONLY the function body code.`;

  const constraints = `

MANDATORY CONSTRAINTS:
- Return plain JavaScript function body only (no markdown or backticks).
- Keep code under ${MAX_CODE_CHARS_TARGET} characters.
- Never use or mention these tokens in code: import, require, eval, Function(, globalThis, self, top, parent, frames, fetch, XMLHttpRequest, WebSocket, setTimeout, setInterval.
- Do not reference browser globals or DOM APIs.
- Use only ctx APIs and local variables.
`;

  if (attempt <= 1 || previousErrors.length === 0) return `${base}${constraints}`;

  return `${base}

Previous attempt was rejected for:
- ${previousErrors.join('\n- ')}

Regenerate from scratch and fix every rejection above.${constraints}`;
}

async function generateWeaponCodeWithRetries(prompt, status) {
  const start = performance.now();
  let lastErrors = [];
  let lastCode = '';

  for (let attempt = 1; attempt <= MAX_FORGE_ATTEMPTS; attempt++) {
    status.textContent = `Forging weapon... (${attempt}/${MAX_FORGE_ATTEMPTS})`;
    status.className = 'forge-loading';

    try {
      const code = await geminiText({
        systemPrompt: CODER_PROMPT,
        userMessage: buildForgeCoderInput(prompt, attempt, lastErrors),
        temperature: 0.55,
        maxTokens: 2400,
      });
      if (!code || !code.trim()) {
        lastErrors = ['Gemini returned an empty response'];
        continue;
      }

      const candidates = buildWeaponCodeCandidates(code);
      if (!candidates.length) {
        lastErrors = ['Gemini returned no usable code candidates'];
        continue;
      }

      let selectedCode = '';
      const candidateErrors = [];
      for (const candidate of candidates) {
        const check = validateAndCompile(candidate);
        if (check.ok) {
          selectedCode = candidate;
          break;
        }
        candidateErrors.push(...check.errors);
      }

      if (selectedCode) {
        return {
          ok: true,
          cleanCode: selectedCode,
          attempts: attempt,
          generationMs: Math.round(performance.now() - start),
          errors: [],
        };
      }

      lastCode = candidates[0] || '';
      lastErrors = [...new Set(candidateErrors)].slice(0, 10);
      console.warn(`Weapon attempt ${attempt} rejected:`, lastErrors);
    } catch (err) {
      lastErrors = [err?.message || 'Gemini request failed'];
      console.warn(`Weapon attempt ${attempt} failed:`, err);
    }
  }

  return {
    ok: false,
    cleanCode: lastCode,
    errors: lastErrors,
    attempts: MAX_FORGE_ATTEMPTS,
    generationMs: Math.round(performance.now() - start),
  };
}

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
      const generationResult = await generateWeaponCodeWithRetries(prompt, status);
      status.textContent = 'Compiling...';
      status.className = 'forge-loading';

      let cleanCode = generationResult.cleanCode;
      let usedFallback = false;

      if (!generationResult.ok || !cleanCode) {
        cleanCode = buildFallbackWeaponCode(prompt);
        usedFallback = true;
      }

      const finalCheck = validateAndCompile(cleanCode);
      if (!finalCheck.ok) {
        if (!usedFallback) {
          cleanCode = buildFallbackWeaponCode(prompt);
          usedFallback = true;
        }
      }

      const fallbackCheck = validateAndCompile(cleanCode);
      if (!fallbackCheck.ok) {
        const msg = 'Weapon generation failed:\n• ' + fallbackCheck.errors.join('\n• ');
        errEl.textContent = msg;
        status.textContent = 'Generation failed — try again';
        status.className = 'forge-fail';
        return;
      }

      console.log(`Weapon generation time: ${generationResult.generationMs} ms (${generationResult.attempts} attempt${generationResult.attempts === 1 ? '' : 's'})`);
      console.log('Generated weapon code:\n', cleanCode);

      if (usedFallback) {
        errEl.textContent = `Original generation was rejected (${generationResult.attempts} attempt${generationResult.attempts === 1 ? '' : 's'}). A safe fallback weapon was created from your prompt.`;
      } else {
        errEl.textContent = '';
      }

      const fn = new Function('ctx', cleanCode);
      setWeapon(fn, prompt, cleanCode);
      MatchMemory.recordWeaponForge(prompt);

      // Generate weapon visuals in background (non-blocking)
      generateWeaponVisuals(prompt).then(visuals => {
        if (visuals) setActiveWeaponVisuals(visuals);
      });
      status.textContent = usedFallback ? 'Weapon ready! (safe fallback)' : 'Weapon ready!';
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
