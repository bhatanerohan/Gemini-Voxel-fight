// src/hud.js — Centralized HUD rendering

export function initHud() {
  hideElement('wave-announce');
  hideElement('wave-clear-banner');
  hideElement('hud-center-message');
}

export function updateWave(n) {
  setText('wave-num', n);
}

export function updateScore(n) {
  const el = document.getElementById('score-num');
  if (!el) return;
  el.textContent = n;
  // Pop animation
  el.classList.remove('pop');
  void el.offsetWidth; // reflow trigger
  el.classList.add('pop');
}

export function updateKills(n) {
  setText('kills-num', n);
}

export function showWaveAnnounce(wave) {
  const el = document.getElementById('wave-announce');
  if (!el) return;
  el.textContent = `WAVE ${wave}`;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 2000);
}

export function showWaveClear() {
  const el = document.getElementById('wave-clear-banner');
  if (!el) return;
  el.textContent = 'WAVE CLEAR!';
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 1500);
}

export function showMessage(text, duration = 2000) {
  const el = document.getElementById('hud-center-message');
  if (!el) return;
  el.textContent = text;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), duration);
}

// DOM element pool for damage numbers
const DMG_POOL_SIZE = 20;
const _dmgPool = [];
let _dmgCursor = 0;

function ensureDmgPool() {
  if (_dmgPool.length > 0) return;
  for (let i = 0; i < DMG_POOL_SIZE; i++) {
    const el = document.createElement('div');
    el.className = 'damage-number';
    el.style.display = 'none';
    document.body.appendChild(el);
    _dmgPool.push(el);
  }
}

export function showDamageNumber(screenX, screenY, damage, color = '#fff') {
  ensureDmgPool();
  const el = _dmgPool[_dmgCursor];
  _dmgCursor = (_dmgCursor + 1) % DMG_POOL_SIZE;
  el.textContent = Math.round(damage);
  el.style.left = screenX + 'px';
  el.style.top = screenY + 'px';
  el.style.color = color;
  el.style.display = '';
  // Reset animation
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  setTimeout(() => { el.style.display = 'none'; }, 800);
}

const _aiHud = {
  panel: null,
  source: null,
  wave: null,
  summary: null,
  spawn: null,
  hp: null,
  speed: null,
  dmg: null,
  cd: null,
  pressureFill: null,
  shift: null,
};
let _aiPanelPulseTimer = null;
let _aiShiftTimer = null;

function ensureAiHud() {
  if (_aiHud.panel) return;
  _aiHud.panel = document.getElementById('ai-balance-panel');
  _aiHud.source = document.getElementById('ai-balance-source');
  _aiHud.wave = document.getElementById('ai-balance-wave');
  _aiHud.summary = document.getElementById('ai-balance-summary');
  _aiHud.spawn = document.getElementById('ai-balance-spawn');
  _aiHud.hp = document.getElementById('ai-balance-hp');
  _aiHud.speed = document.getElementById('ai-balance-speed');
  _aiHud.dmg = document.getElementById('ai-balance-dmg');
  _aiHud.cd = document.getElementById('ai-balance-cd');
  _aiHud.pressureFill = document.getElementById('ai-balance-pressure-fill');
  _aiHud.shift = document.getElementById('ai-balance-shift');
}

function formatMult(value, fallback = 1) {
  const num = Number(value);
  const out = Number.isFinite(num) ? num : fallback;
  return `${out.toFixed(2)}x`;
}

function clamp(value, min, max, fallback = min) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function initAiBalanceHud(data = {}) {
  updateAiBalanceHud(data, { announce: false });
}

export function updateAiBalanceHud(data = {}, opts = {}) {
  ensureAiHud();
  if (!_aiHud.panel) return;

  const profile = data.profile && typeof data.profile === 'object' ? data.profile : data;
  const source = String(data.source || profile.source || 'base').toUpperCase();
  const waveApplied = Number(data.waveApplied || profile.waveApplied || 1);
  const summary = typeof profile.summary === 'string' && profile.summary.trim()
    ? profile.summary.trim().slice(0, 80)
    : 'Adaptive balance active';

  _aiHud.source.textContent = source;
  _aiHud.wave.textContent = Number.isFinite(waveApplied) && waveApplied > 0 ? waveApplied : 1;
  _aiHud.summary.textContent = summary;
  _aiHud.spawn.textContent = formatMult(profile.spawnCountMult, 1);
  _aiHud.hp.textContent = formatMult(profile.enemyHpMult, 1);
  _aiHud.speed.textContent = formatMult(profile.enemySpeedMult, 1);
  _aiHud.dmg.textContent = formatMult(profile.enemyDamageMult, 1);
  _aiHud.cd.textContent = formatMult(profile.enemyCooldownMult, 1);

  const pressureScore = clamp(profile.pressureScore, 0.65, 1.65, 1);
  const pressureNorm = clamp((pressureScore - 0.65) / 1.0, 0, 1, 0.35);
  const pressurePercent = Math.round(pressureNorm * 100);
  _aiHud.pressureFill.style.width = `${pressurePercent}%`;

  _aiHud.panel.classList.remove('updated');
  void _aiHud.panel.offsetWidth;
  _aiHud.panel.classList.add('updated');
  if (_aiPanelPulseTimer) clearTimeout(_aiPanelPulseTimer);
  _aiPanelPulseTimer = setTimeout(() => _aiHud.panel?.classList.remove('updated'), 900);

  if (!opts.announce) return;
  if (!_aiHud.shift) return;

  const trend = Math.round((pressureScore - 1) * 100);
  const trendLabel = trend >= 0 ? `+${trend}` : `${trend}`;
  _aiHud.shift.textContent = `AI Rebalance: W${_aiHud.wave.textContent} ${trendLabel}% pressure`;
  _aiHud.shift.classList.remove('up', 'down', 'visible');
  if (trend >= 5) _aiHud.shift.classList.add('up');
  else if (trend <= -5) _aiHud.shift.classList.add('down');
  void _aiHud.shift.offsetWidth;
  _aiHud.shift.classList.add('visible');

  if (_aiShiftTimer) clearTimeout(_aiShiftTimer);
  _aiShiftTimer = setTimeout(() => {
    if (!_aiHud.shift) return;
    _aiHud.shift.classList.remove('visible');
    _aiHud.shift.classList.remove('up', 'down');
  }, 2300);
}

export function updateLevelDisplay(level, xp, xpToNext, title) {
  const el = document.getElementById('player-level');
  if (!el) return;
  el.textContent = '';
  const pct = xpToNext > 0 ? Math.round((xp / xpToNext) * 100) : 0;
  if (title) {
    const titleSpan = document.createElement('span');
    titleSpan.className = 'player-title';
    titleSpan.textContent = title;
    el.appendChild(titleSpan);
  }
  const levelSpan = document.createElement('span');
  levelSpan.className = 'level-label';
  levelSpan.textContent = `LV ${level}`;
  el.appendChild(levelSpan);
  const xpBar = document.createElement('div');
  xpBar.className = 'xp-bar';
  const xpFill = document.createElement('div');
  xpFill.className = 'xp-fill';
  xpFill.style.width = `${pct}%`;
  xpBar.appendChild(xpFill);
  el.appendChild(xpBar);
  const xpText = document.createElement('span');
  xpText.className = 'xp-text';
  xpText.textContent = `${xp}/${xpToNext} XP`;
  el.appendChild(xpText);
}

// Helpers
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('visible');
}
