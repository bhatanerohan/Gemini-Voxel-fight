// src/narratorUI.js — Cinematic battle narrator text overlay with word streaming

let narratorEl = null;
let hideTimeout = null;
let streamInterval = null;

export function initNarrator() {
  narratorEl = document.getElementById('narrator-overlay');
}

export function showNarratorLine(text, mood = 'epic', duration = 3500) {
  if (!narratorEl || !text) return;
  if (hideTimeout) clearTimeout(hideTimeout);
  if (streamInterval) clearInterval(streamInterval);

  narratorEl.textContent = '';
  narratorEl.className = `narrator-overlay narrator-${mood} narrator-show`;

  // Stream words one at a time
  const words = text.split(/\s+/);
  let idx = 0;
  streamInterval = setInterval(() => {
    if (idx >= words.length) {
      clearInterval(streamInterval);
      streamInterval = null;
      // Start hide timer after all words shown
      hideTimeout = setTimeout(() => {
        narratorEl.classList.remove('narrator-show');
        narratorEl.classList.add('narrator-hide');
      }, duration);
      return;
    }
    narratorEl.textContent += (idx > 0 ? ' ' : '') + words[idx];
    idx++;
  }, 120);
}
