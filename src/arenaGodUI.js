// src/arenaGodUI.js — Arena God dialogue display

let typewriterInterval = null;
let fadeTimeout = null;

const TONES = ['amused', 'angry', 'impressed', 'bored', 'contemptuous', 'neutral'];

/**
 * Display Arena God dialogue with typewriter effect.
 * @param {string} text - The dialogue line
 * @param {string} tone - 'amused' | 'angry' | 'impressed' | 'bored' | 'contemptuous' | 'neutral'
 * @param {number} [duration=5000] - How long to show after typing completes (ms)
 */
export function showGodDialogue(text, tone = 'neutral', duration = 5000) {
  clearInterval(typewriterInterval);
  clearTimeout(fadeTimeout);

  const container = document.getElementById('arena-god');
  const textEl = document.getElementById('god-text');
  if (!container || !textEl) return;

  // Remove all tone classes, add new one
  TONES.forEach(t => container.classList.remove(t));
  container.classList.add(tone);

  // Show container
  container.classList.add('visible');

  // Typewriter effect
  textEl.textContent = '';
  let i = 0;
  typewriterInterval = setInterval(() => {
    textEl.textContent += text[i];
    i++;
    if (i >= text.length) {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
      // Auto-hide after duration
      fadeTimeout = setTimeout(() => {
        container.classList.remove('visible');
      }, duration);
    }
  }, 30);
}

/**
 * Immediately hide the God dialogue.
 */
export function hideGodDialogue() {
  clearInterval(typewriterInterval);
  clearTimeout(fadeTimeout);
  typewriterInterval = null;
  fadeTimeout = null;

  const container = document.getElementById('arena-god');
  const textEl = document.getElementById('god-text');
  if (container) container.classList.remove('visible');
  if (textEl) textEl.textContent = '';
}

/**
 * Quick flash message from the God (mid-combat quips).
 * No typewriter — just pop in, shorter duration.
 */
export function flashGodQuip(text, tone = 'amused', duration = 2500) {
  clearInterval(typewriterInterval);
  clearTimeout(fadeTimeout);
  typewriterInterval = null;

  const container = document.getElementById('arena-god');
  const textEl = document.getElementById('god-text');
  if (!container || !textEl) return;

  TONES.forEach(t => container.classList.remove(t));
  container.classList.add(tone);

  textEl.textContent = text;
  container.classList.add('visible');

  fadeTimeout = setTimeout(() => {
    container.classList.remove('visible');
  }, duration);
}
