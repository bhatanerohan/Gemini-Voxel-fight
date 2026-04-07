import {
  getActiveWeaponIndex,
  getWeaponLoadoutSnapshot,
  selectWeaponSlot,
  setWeapon,
} from './sandbox.js';
import { CODER_PROMPT, WEAPON_BALANCE_PROMPT } from './prompt.js';
import {
  DEFAULT_WEAPON_FIRE_MODE,
  DEFAULT_WEAPON_TIER,
  FIRE_PROFILE_OVERVIEW,
  getWeaponFireProfile,
  sanitizeWeaponFireMode,
  sanitizeWeaponTier,
} from './weaponBalance.js';

const OPENAI_CHAT_COMPLETIONS_PATH = '/openai/chat/completions';
const OPENAI_MODELS = ['gpt-5.2'];

let forgeOpen = true;
let onOpenCb = null;
let onCloseCb = null;
let loadoutRefreshTimer = null;

export function isForgeOpen() { return forgeOpen; }

function formatCooldownSeconds(seconds) {
  if (seconds >= 10) return `${seconds.toFixed(0)}s`;
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  return `${seconds.toFixed(2)}s`;
}

function describeWeaponFireProfile(fireMode, tier) {
  const profile = getWeaponFireProfile(tier, fireMode);
  if (profile.fireMode === 'continuous') {
    return `${profile.fireModeLabel} | ${profile.tierLabel} | ${formatCooldownSeconds(profile.channelMs / 1000)} channel / ${formatCooldownSeconds(profile.cooldownMs / 1000)} recovery`;
  }
  return `${profile.fireModeLabel} | ${profile.tierLabel} | ${formatCooldownSeconds(profile.cooldownMs / 1000)} cooldown`;
}

function getShell() { return document.getElementById('forge-shell'); }
function getInput() { return document.getElementById('forge-input'); }
function getButton() { return document.getElementById('forge-btn'); }
function getStatus() { return document.getElementById('forge-status'); }
function getError() { return document.getElementById('forge-error'); }
function getToggle() { return document.getElementById('forge-toggle'); }
function getLoadoutContainer() { return document.getElementById('forge-loadout'); }
function getCooldownReadout() { return document.getElementById('forge-cooldown'); }

function updateCooldownReadout(slot = null) {
  const readout = getCooldownReadout();
  if (!readout) return;
  if (slot?.hasWeapon && Number.isInteger(slot.tier)) {
    readout.textContent = describeWeaponFireProfile(slot.fireMode, slot.tier);
    return;
  }
  readout.textContent = FIRE_PROFILE_OVERVIEW;
}

function updateToggleText() {
  const toggle = getToggle();
  if (!toggle) return;
  toggle.textContent = forgeOpen ? 'Hide Forge' : 'Forge';
}

function dispatchSlotSelected(slotIndex) {
  window.dispatchEvent(new CustomEvent('weapon-slot-selected', {
    detail: { slotIndex },
  }));
}

function trimFencedText(text) {
  return String(text || '')
    .trim()
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractJsonObjectText(text) {
  const trimmed = trimFencedText(text);
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parseWeaponBalanceResponse(text) {
  const jsonText = extractJsonObjectText(text);
  try {
    const payload = JSON.parse(jsonText);
    return {
      fireMode: sanitizeWeaponFireMode(payload.fireMode ?? payload.mode, DEFAULT_WEAPON_FIRE_MODE),
      tier: sanitizeWeaponTier(payload.weaponTier ?? payload.tier, DEFAULT_WEAPON_TIER),
      summary: typeof payload.summary === 'string' ? payload.summary.trim() : '',
    };
  } catch {
    const tierMatch = String(text || '').match(/"(?:weaponTier|tier)"\s*:\s*([1-4])/i);
    const modeMatch = String(text || '').match(/"(?:fireMode|mode)"\s*:\s*"(instant|continuous)"/i);
    return {
      fireMode: sanitizeWeaponFireMode(modeMatch?.[1], DEFAULT_WEAPON_FIRE_MODE),
      tier: sanitizeWeaponTier(tierMatch?.[1], DEFAULT_WEAPON_TIER),
      summary: '',
    };
  }
}

function buildCoderInput(prompt, balanceMeta) {
  const runtimeProfile = JSON.stringify({
    fireMode: sanitizeWeaponFireMode(balanceMeta.fireMode, DEFAULT_WEAPON_FIRE_MODE),
    weaponTier: sanitizeWeaponTier(balanceMeta.tier, DEFAULT_WEAPON_TIER),
  }, null, 2);

  return `## PLAYER WEAPON REQUEST:\n"${prompt}"\n\n## RUNTIME FIRE PROFILE\n${runtimeProfile}\n\nIf fireMode is \"continuous\", each call represents ONE short channel tick while the trigger is held. Build a short repeated slice of the effect, not a self-sustained multi-second loop, unless the tick intentionally leaves behind a brief lingering aftermath.\n\nIf fireMode is \"instant\", each call represents one complete activation.\n\nImplement a weapon that matches this request and this runtime fire profile. Output ONLY the function body code.`;
}

function buildBalanceInput(prompt) {
  return `## PLAYER WEAPON REQUEST:\n"${prompt}"\n\nClassify this weapon into exactly one fire mode and one of the 4 fixed weapon tiers. Output ONLY the required JSON.`;
}

async function classifyWeaponBalance(prompt) {
  const { content } = await callLLM(WEAPON_BALANCE_PROMPT, buildBalanceInput(prompt));
  return parseWeaponBalanceResponse(content);
}

function describeSlotStatus(slot) {
  if (slot.fireMode === 'continuous' && slot.fireState === 'channeling' && slot.channelRemaining > 0) {
    return `Channeling ${formatCooldownSeconds(slot.channelRemaining)}`;
  }
  if (slot.cooldownRemaining > 0) {
    return slot.fireMode === 'continuous'
      ? `Recovering ${formatCooldownSeconds(slot.cooldownRemaining)}`
      : `Cooling ${formatCooldownSeconds(slot.cooldownRemaining)}`;
  }
  if (Number.isInteger(slot.tier)) {
    return describeWeaponFireProfile(slot.fireMode, slot.tier);
  }
  return `${formatCooldownSeconds(slot.cooldownMs / 1000)} cooldown`;
}

export function refreshForgePanel() {
  const loadoutEl = getLoadoutContainer();
  if (!loadoutEl) return;

  const snapshot = getWeaponLoadoutSnapshot();
  const activeIndex = getActiveWeaponIndex();
  const activeSlot = snapshot[activeIndex] || null;
  updateCooldownReadout(activeSlot);

  loadoutEl.innerHTML = snapshot.map((slot) => {
    const classes = [
      'forge-slot-card',
      slot.isActive ? 'active' : '',
      slot.hasWeapon ? '' : 'empty',
    ].filter(Boolean).join(' ');
    const weaponName = slot.name || `Empty Slot ${slot.index + 1}`;
    const slotMeta = describeSlotStatus(slot);
    return `
      <button type="button" class="${classes}" data-slot-index="${slot.index}">
        <span class="forge-slot-index">Slot ${slot.index + 1}</span>
        <span class="forge-slot-name">${weaponName}</span>
        <span class="forge-slot-meta">${slot.index === activeIndex ? 'Selected for equip + forge' : 'Click to select'} - ${slotMeta}</span>
      </button>
    `;
  }).join('');
}

export function initForge(callbacks = {}) {
  onOpenCb = callbacks.onOpen;
  onCloseCb = callbacks.onClose;

  const shell = getShell();
  const input = getInput();
  const btn = getButton();
  const toggle = getToggle();
  const closeBtn = document.getElementById('forge-close');
  const loadoutEl = getLoadoutContainer();

  shell.classList.toggle('open', forgeOpen);
  updateToggleText();
  refreshForgePanel();

  if (loadoutRefreshTimer) window.clearInterval(loadoutRefreshTimer);
  loadoutRefreshTimer = window.setInterval(refreshForgePanel, 100);
  window.addEventListener('weapon-slot-selected', refreshForgePanel);
  window.addEventListener('weapon-forged', refreshForgePanel);

  toggle.addEventListener('click', () => {
    if (forgeOpen) closeForge();
    else openForge();
  });
  closeBtn.addEventListener('click', closeForge);

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doForge();
    }
    if (e.key === 'Escape') closeForge();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  btn.addEventListener('click', doForge);

  loadoutEl.addEventListener('click', (e) => {
    const button = e.target.closest('[data-slot-index]');
    if (!button) return;
    const slotIndex = Number(button.dataset.slotIndex);
    if (!Number.isFinite(slotIndex)) return;
    selectWeaponSlot(slotIndex);
    dispatchSlotSelected(slotIndex);
    refreshForgePanel();
  });

  async function doForge() {
    const prompt = input.value.trim();
    if (!prompt) return;

    const statusEl = getStatus();
    const errEl = getError();
    const targetSlot = getActiveWeaponIndex();

    btn.disabled = true;
    errEl.textContent = '';

    try {
      statusEl.textContent = `Classifying fire mode and tier for slot ${targetSlot + 1}...`;
      const balanceResult = await classifyWeaponBalance(prompt).catch((err) => {
        console.warn('Weapon balance classification failed, using defaults.', err);
        return {
          fireMode: DEFAULT_WEAPON_FIRE_MODE,
          tier: DEFAULT_WEAPON_TIER,
          summary: '',
        };
      });
      const fireMode = sanitizeWeaponFireMode(balanceResult.fireMode, DEFAULT_WEAPON_FIRE_MODE);
      const tier = sanitizeWeaponTier(balanceResult.tier, DEFAULT_WEAPON_TIER);
      const profile = getWeaponFireProfile(tier, fireMode);

      statusEl.textContent = `Generating ${profile.fireModeLabel.toLowerCase()} weapon for slot ${targetSlot + 1}...`;
      const generationStart = performance.now();
      const { content, model } = await callLLM(CODER_PROMPT, buildCoderInput(prompt, { fireMode, tier }));
      const generationMs = Math.round(performance.now() - generationStart);
      const cleanCode = trimFencedText(content);

      statusEl.textContent = 'Compiling...';
      console.log('OpenAI model used:', model, `| generation time: ${generationMs} ms`);
      console.log('Generated weapon code:\n', cleanCode);
      console.log('Assigned weapon fire profile:', { fireMode, tier, summary: balanceResult.summary, profile });

      const fn = new Function('ctx', cleanCode);
      setWeapon(fn, prompt, undefined, {
        code: cleanCode,
        slotIndex: targetSlot,
        cooldownMs: profile.cooldownMs,
        tier,
        fireMode,
        reset: false,
      });

      refreshForgePanel();
      statusEl.textContent = `Weapon ready in slot ${targetSlot + 1}! ${describeWeaponFireProfile(fireMode, tier)}.`;
      window.dispatchEvent(new CustomEvent('weapon-forged', {
        detail: {
          name: prompt,
          code: cleanCode,
          slotIndex: targetSlot,
          cooldownMs: profile.cooldownMs,
          tier,
          fireMode,
          activeIndex: getActiveWeaponIndex(),
        },
      }));
    } catch (err) {
      console.error('Forge error:', err);
      errEl.textContent = err.message;
      statusEl.textContent = 'Failed - try again';
    } finally {
      btn.disabled = false;
    }
  }
}

export function openForge() {
  forgeOpen = true;
  getShell()?.classList.add('open');
  refreshForgePanel();
  getInput()?.focus();
  const errEl = getError();
  const statusEl = getStatus();
  if (errEl) errEl.textContent = '';
  if (statusEl) statusEl.textContent = '';
  updateToggleText();
  onOpenCb?.();
}

export function closeForge() {
  forgeOpen = false;
  getShell()?.classList.remove('open');
  getInput()?.blur();
  updateToggleText();
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
  throw new Error('OpenAI returned an empty response.');
}

async function requestCompletion(systemPrompt, userMessage, model) {
  const res = await fetch(OPENAI_CHAT_COMPLETIONS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_completion_tokens: 12000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message = err.error?.message || `OpenAI API error ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  const data = await res.json();
  return {
    content: extractMessageText(data),
    model,
  };
}

async function callLLM(systemPrompt, userMessage, models = OPENAI_MODELS) {
  let lastError = null;
  for (const model of models) {
    try {
      return await requestCompletion(systemPrompt, userMessage, model);
    } catch (err) {
      lastError = err;
      if (err?.status === 401 || err?.status === 403) break;
    }
  }

  throw lastError || new Error('OpenAI request failed.');
}
