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
