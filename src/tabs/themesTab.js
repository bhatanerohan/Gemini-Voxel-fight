// src/tabs/themesTab.js — Themes settings tab
import { registerTab, handlePresetDelete, showToast } from '../settingsPanel.js';
import { loadPresets, addPreset, getActiveId, setActiveId } from '../settingsStorage.js';
import { applyTheme, generateTheme, PRESETS, validateThemeConfig } from '../themeManager.js';

const BUILT_IN = Object.entries(PRESETS).map(([key, preset]) => ({
  id: key,
  builtIn: true,
  name: preset.name,
  config: preset,
}));

let _container = null;
let _listEl = null;
let _generating = false;

export function initThemesTab() {
  _container = document.createElement('div');
  _container.className = 'settings-tab-content';

  registerTab('themes', _container, _setup);
}

function _setup() {
  _container.innerHTML = `
    <div class="stab-section">
      <div class="stab-section-title">Theme Presets</div>
      <div class="stab-preset-grid" id="themes-preset-list"></div>
    </div>
    <div class="stab-section">
      <div class="stab-section-title">AI Generate</div>
      <div class="stab-generate">
        <input class="stab-input" id="themes-hint" placeholder="e.g. underwater temple, blood moon..." maxlength="60" />
        <div class="stab-btn-row">
          <button class="stab-btn-primary" id="themes-generate-btn">Generate Theme</button>
        </div>
        <div class="stab-status" id="themes-status"></div>
        <div class="stab-preview" id="themes-preview" style="display:none"></div>
        <div class="stab-btn-row" id="themes-save-row" style="display:none">
          <button class="stab-btn-primary" id="themes-save-btn">Save Theme</button>
          <button class="stab-btn-secondary" id="themes-discard-btn">Discard</button>
        </div>
      </div>
    </div>
  `;

  _listEl = _container.querySelector('#themes-preset-list');
  _container.querySelector('#themes-generate-btn').addEventListener('click', _onGenerate);
  _container.querySelector('#themes-save-btn')?.addEventListener('click', _onSave);
  _container.querySelector('#themes-discard-btn')?.addEventListener('click', _onDiscard);

  _container._refresh = _renderList;
  _renderList();
}

let _pendingConfig = null;

function _renderList() {
  if (!_listEl) return;
  const customs = loadPresets('themes');
  const activeId = getActiveId('themes') || 'neon';
  const all = [...BUILT_IN, ...customs];

  _listEl.innerHTML = '';
  for (const preset of all) {
    const card = document.createElement('div');
    card.className = 'stab-preset-card' + (preset.id === activeId ? ' active' : '');

    const config = preset.config || preset;
    const colors = [
      config.background || '#000',
      config.accent?.color || config.accent || '#0ff',
      config.boundary?.color || config.boundary || '#0ff',
      config.ground || '#111',
    ];

    card.innerHTML = `
      <div class="stab-color-strip">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="preset-name">${preset.name || 'Unnamed'}</div>
      ${!preset.builtIn ? '<button class="preset-delete" title="Delete">&#10005;</button>' : ''}
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-delete')) return;
      const cfg = preset.config || validateThemeConfig(preset);
      applyTheme(cfg);
      setActiveId('themes', preset.id);
      _renderList();
    });

    const delBtn = card.querySelector('.preset-delete');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePresetDelete('themes', preset.id, preset.name);
        _renderList();
      });
    }

    _listEl.appendChild(card);
  }

  if (customs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'stab-empty';
    empty.textContent = 'No custom themes yet — generate one below';
    _listEl.appendChild(empty);
  }
}

async function _onGenerate() {
  if (_generating) return;
  _generating = true;
  const btn = _container.querySelector('#themes-generate-btn');
  const status = _container.querySelector('#themes-status');
  const hint = _container.querySelector('#themes-hint').value.trim();

  btn.disabled = true;
  status.textContent = 'Generating theme...';
  status.className = 'stab-status loading';

  const config = await generateTheme(hint || null);

  if (config) {
    _pendingConfig = config;
    applyTheme(config);
    _showPreview(config);
    status.textContent = 'Theme applied — save it or discard';
    status.className = 'stab-status success';
  } else {
    status.textContent = 'Generation failed — try again';
    status.className = 'stab-status error';
  }

  btn.disabled = false;
  _generating = false;
}

function _showPreview(config) {
  const preview = _container.querySelector('#themes-preview');
  const saveRow = _container.querySelector('#themes-save-row');
  const colors = [config.background, config.ground, config.accent?.color, config.boundary?.color, config.hud?.primary].filter(Boolean);
  preview.innerHTML = `
    <div class="stab-color-strip">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
    <div style="font-weight:bold;margin-top:6px">${config.name || 'AI Theme'}</div>
  `;
  preview.style.display = '';
  saveRow.style.display = '';
}

function _onSave() {
  if (!_pendingConfig) return;
  const saved = addPreset('themes', {
    name: _pendingConfig.name || 'AI Theme',
    config: _pendingConfig,
  });
  if (saved) {
    // Set as active
    const customs = loadPresets('themes');
    const last = customs[customs.length - 1];
    if (last) setActiveId('themes', last.id);
    showToast(`Saved "${_pendingConfig.name}"`);
  } else {
    showToast('Max 20 custom themes reached');
  }
  _onDiscard();
  _renderList();
}

function _onDiscard() {
  _pendingConfig = null;
  const preview = _container.querySelector('#themes-preview');
  const saveRow = _container.querySelector('#themes-save-row');
  const status = _container.querySelector('#themes-status');
  if (preview) preview.style.display = 'none';
  if (saveRow) saveRow.style.display = 'none';
  if (status) { status.textContent = ''; status.className = 'stab-status'; }
}
