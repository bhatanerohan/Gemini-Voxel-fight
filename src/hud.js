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

export function showDamageNumber(screenX, screenY, damage, color = '#fff') {
  const el = document.createElement('div');
  el.className = 'damage-number';
  el.textContent = Math.round(damage);
  el.style.left = screenX + 'px';
  el.style.top = screenY + 'px';
  el.style.color = color;
  document.body.appendChild(el);
  // Remove after animation completes
  setTimeout(() => el.remove(), 800);
}

export function updateLevelDisplay(level, xp, xpToNext, title) {
  const el = document.getElementById('player-level');
  if (!el) return;
  const titleHtml = title ? `<span class="player-title">${title}</span>` : '';
  const pct = xpToNext > 0 ? Math.round((xp / xpToNext) * 100) : 0;
  el.innerHTML = `${titleHtml}<span class="level-label">LV ${level}</span><div class="xp-bar"><div class="xp-fill" style="width:${pct}%"></div></div><span class="xp-text">${xp}/${xpToNext} XP</span>`;
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
