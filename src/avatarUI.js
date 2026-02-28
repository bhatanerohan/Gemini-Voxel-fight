// src/avatarUI.js — Pre-game "Describe your fighter" screen
import { generateAvatarConfig, getDefaultAvatarConfig } from './llama/avatarAgent.js';

let _onComplete = null;

export function initAvatarUI(onComplete) {
  _onComplete = onComplete;

  const overlay = document.getElementById('avatar-overlay');
  const input = document.getElementById('avatar-input');
  const btn = document.getElementById('avatar-btn');
  const skipBtn = document.getElementById('avatar-skip');
  const status = document.getElementById('avatar-status');
  const presets = document.querySelectorAll('.avatar-preset');

  if (!overlay || !input || !btn) return;

  btn.addEventListener('click', () => doGenerate(input.value.trim()));
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      doGenerate(input.value.trim());
    }
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());

  skipBtn?.addEventListener('click', () => {
    overlay.classList.remove('open');
    _onComplete?.(getDefaultAvatarConfig());
  });

  // Preset buttons
  presets.forEach(preset => {
    preset.addEventListener('click', () => {
      const desc = preset.dataset.desc;
      input.value = desc;
      doGenerate(desc);
    });
  });

  async function doGenerate(description) {
    if (!description) return;

    btn.disabled = true;
    status.textContent = 'Generating your fighter...';
    status.className = 'avatar-loading';

    try {
      const config = await generateAvatarConfig(description);
      status.textContent = `${config.name} — ${config.personality}`;
      status.className = 'avatar-success';

      // Brief pause to show the result
      setTimeout(() => {
        overlay.classList.remove('open');
        _onComplete?.(config);
      }, 1200);
    } catch (err) {
      console.error('Avatar generation failed:', err);
      status.textContent = 'Generation failed — using default';
      status.className = 'avatar-fail';
      setTimeout(() => {
        overlay.classList.remove('open');
        _onComplete?.(getDefaultAvatarConfig());
      }, 1000);
    } finally {
      btn.disabled = false;
    }
  }
}

export function showAvatarUI() {
  const overlay = document.getElementById('avatar-overlay');
  if (overlay) {
    overlay.classList.add('open');
    document.getElementById('avatar-input')?.focus();
  }
}
