// src/themeUI.js — Theme panel HUD overlay
import { applyTheme, generateTheme, PRESETS, getCurrentThemeName } from './themeManager.js';

let _panel = null;
let _toggleBtn = null;
let _generateBtn = null;
let _hintInput = null;
let _generating = false;

export function initThemeUI() {
  // Toggle button
  _toggleBtn = document.createElement('button');
  _toggleBtn.id = 'theme-toggle-btn';
  _toggleBtn.title = 'Themes';
  _toggleBtn.textContent = '\uD83C\uDFA8';
  document.body.appendChild(_toggleBtn);

  // Panel
  _panel = document.createElement('div');
  _panel.id = 'theme-panel';
  _panel.className = 'hidden';

  // Preset buttons
  const presetsDiv = document.createElement('div');
  presetsDiv.className = 'theme-presets';
  for (const [key, preset] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.className = 'theme-preset-btn' + (key === 'neon' ? ' active' : '');
    btn.dataset.theme = key;
    btn.textContent = preset.name;
    btn.addEventListener('click', () => {
      applyTheme(preset);
      _updateActivePreset(key);
      _closePanel();
    });
    presetsDiv.appendChild(btn);
  }
  _panel.appendChild(presetsDiv);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'theme-divider';
  _panel.appendChild(divider);

  // Generate section
  const genDiv = document.createElement('div');
  genDiv.className = 'theme-generate';

  _hintInput = document.createElement('input');
  _hintInput.type = 'text';
  _hintInput.id = 'theme-hint-input';
  _hintInput.placeholder = 'e.g. underwater temple';
  _hintInput.maxLength = 60;
  _hintInput.addEventListener('focus', () => { window._blockGameInput = true; });
  _hintInput.addEventListener('blur', () => { window._blockGameInput = false; });
  genDiv.appendChild(_hintInput);

  _generateBtn = document.createElement('button');
  _generateBtn.id = 'theme-generate-btn';
  _generateBtn.textContent = 'Generate';
  _generateBtn.addEventListener('click', _onGenerate);
  genDiv.appendChild(_generateBtn);

  _panel.appendChild(genDiv);
  document.body.appendChild(_panel);

  // Toggle
  _toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _panel.classList.toggle('hidden');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!_panel.classList.contains('hidden') && !_panel.contains(e.target) && e.target !== _toggleBtn) {
      _closePanel();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !_panel.classList.contains('hidden')) {
      _closePanel();
    }
  });
}

function _closePanel() {
  _panel.classList.add('hidden');
  _hintInput.blur();
}

function _updateActivePreset(key) {
  _panel.querySelectorAll('.theme-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === key);
  });
}

async function _onGenerate() {
  if (_generating) return;
  _generating = true;
  _generateBtn.disabled = true;
  _generateBtn.textContent = 'Generating...';
  _generateBtn.classList.remove('error');

  const hint = _hintInput.value.trim();
  const config = await generateTheme(hint || null);

  if (config) {
    applyTheme(config);
    // Clear active preset since this is a custom theme
    _updateActivePreset('');
    _closePanel();
  } else {
    _generateBtn.classList.add('error');
    _generateBtn.textContent = 'Failed — try again';
    setTimeout(() => {
      _generateBtn.classList.remove('error');
      _generateBtn.textContent = 'Generate';
    }, 2000);
  }

  _generating = false;
  _generateBtn.disabled = false;
}
