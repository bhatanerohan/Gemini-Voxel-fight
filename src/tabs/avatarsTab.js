// src/tabs/avatarsTab.js — Avatars settings tab
import { registerTab, handlePresetDelete, showToast } from '../settingsPanel.js';
import { loadPresets, addPreset, getActiveId, setActiveId } from '../settingsStorage.js';
import { generateAvatarConfig, getDefaultAvatarConfig } from '../llama/avatarAgent.js';

// Built-in avatar presets matching the pre-game screen
const BUILT_IN_AVATARS = [
  { id: 'cyber-ninja', builtIn: true, name: 'Cyber-Ninja', description: 'neon cyber-ninja with electric blue visor',
    config: null },
  { id: 'lava-golem', builtIn: true, name: 'Lava Golem', description: 'molten lava golem with cracked armor',
    config: null },
  { id: 'frost-witch', builtIn: true, name: 'Frost Witch', description: 'frost witch with ice crystal crown',
    config: null },
  { id: 'shadow', builtIn: true, name: 'Shadow', description: 'void shadow assassin, dark purple with glowing eyes',
    config: null },
];

let _container = null;
let _listEl = null;
let _generating = false;
let _applyCallback = null; // Set from main.js

export function setAvatarApplyCallback(cb) {
  _applyCallback = cb;
}

export function initAvatarsTab() {
  _container = document.createElement('div');
  _container.className = 'settings-tab-content';

  registerTab('avatars', _container, _setup);
}

function _setup() {
  _container.innerHTML = `
    <div class="stab-section">
      <div class="stab-section-title">Avatar Presets</div>
      <div class="stab-preset-grid" id="avatars-preset-list"></div>
    </div>
    <div class="stab-section">
      <div class="stab-section-title">AI Generate</div>
      <div class="stab-generate">
        <input class="stab-input" id="avatars-prompt" placeholder="e.g. cyberpunk samurai, molten lava golem..." maxlength="120" />
        <div class="stab-btn-row">
          <button class="stab-btn-primary" id="avatars-generate-btn">Generate Avatar</button>
        </div>
        <div class="stab-status" id="avatars-status"></div>
        <div class="stab-preview" id="avatars-preview" style="display:none"></div>
        <div class="stab-btn-row" id="avatars-save-row" style="display:none">
          <button class="stab-btn-primary" id="avatars-save-btn">Save Avatar</button>
          <button class="stab-btn-secondary" id="avatars-discard-btn">Discard</button>
        </div>
      </div>
    </div>
  `;

  _listEl = _container.querySelector('#avatars-preset-list');
  _container.querySelector('#avatars-generate-btn').addEventListener('click', _onGenerate);
  _container.querySelector('#avatars-save-btn')?.addEventListener('click', _onSave);
  _container.querySelector('#avatars-discard-btn')?.addEventListener('click', _onDiscard);

  _container._refresh = _renderList;
  _renderList();
}

let _pendingConfig = null;

function _renderList() {
  if (!_listEl) return;
  const customs = loadPresets('avatars');
  const activeId = getActiveId('avatars');
  const all = [...BUILT_IN_AVATARS, ...customs];

  _listEl.innerHTML = '';
  for (const avatar of all) {
    const card = document.createElement('div');
    card.className = 'stab-preset-card' + (avatar.id === activeId ? ' active' : '');

    const config = avatar.config;
    const colors = config?.colors
      ? [config.colors.primary, config.colors.accent, config.colors.visor]
      : ['#4488ff', '#ffaa00', '#00ffff'];

    card.innerHTML = `
      <div class="stab-color-strip">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="preset-name">${avatar.name || 'Unnamed'}</div>
      <div class="preset-info">${avatar.config?.personality || avatar.description || ''}</div>
      ${!avatar.builtIn ? '<button class="preset-delete" title="Delete">&#10005;</button>' : ''}
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-delete')) return;
      _applyAvatar(avatar);
    });

    const delBtn = card.querySelector('.preset-delete');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePresetDelete('avatars', avatar.id, avatar.name);
        _renderList();
      });
    }

    _listEl.appendChild(card);
  }
}

async function _applyAvatar(avatar) {
  // For built-in presets without a config, generate it on-the-fly
  if (avatar.builtIn && !avatar.config) {
    const status = _container.querySelector('#avatars-status');
    status.textContent = `Generating ${avatar.name}...`;
    status.className = 'stab-status loading';

    try {
      const config = await generateAvatarConfig(avatar.description);
      avatar.config = config;
      if (_applyCallback) _applyCallback(config);
      setActiveId('avatars', avatar.id);
      status.textContent = `${config.name} applied!`;
      status.className = 'stab-status success';
      _renderList();
    } catch (e) {
      status.textContent = 'Failed to generate';
      status.className = 'stab-status error';
    }
    return;
  }

  if (avatar.config && _applyCallback) {
    _applyCallback(avatar.config);
    setActiveId('avatars', avatar.id);
    _renderList();
  }
}

async function _onGenerate() {
  if (_generating) return;
  _generating = true;

  const btn = _container.querySelector('#avatars-generate-btn');
  const status = _container.querySelector('#avatars-status');
  const prompt = _container.querySelector('#avatars-prompt').value.trim();
  if (!prompt) { _generating = false; return; }

  btn.disabled = true;
  status.textContent = 'Generating avatar...';
  status.className = 'stab-status loading';

  try {
    const config = await generateAvatarConfig(prompt);
    _pendingConfig = config;

    if (_applyCallback) _applyCallback(config);
    _showPreview(config);
    status.textContent = `${config.name} — ${config.personality}`;
    status.className = 'stab-status success';
  } catch (e) {
    status.textContent = 'Generation failed';
    status.className = 'stab-status error';
  }

  btn.disabled = false;
  _generating = false;
}

function _showPreview(config) {
  const preview = _container.querySelector('#avatars-preview');
  const saveRow = _container.querySelector('#avatars-save-row');
  const colors = config.colors
    ? [config.colors.primary, config.colors.secondary, config.colors.accent, config.colors.visor]
    : [];

  const accessories = (config.accessories || []).map(a => a.type).join(', ') || 'None';

  preview.innerHTML = `
    <div class="stab-color-strip">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
    <div style="font-weight:bold;margin-top:6px">${config.name || 'AI Avatar'}</div>
    <div style="color:#888;font-size:10px;margin-top:2px">${config.personality || ''}</div>
    <div style="color:#666;font-size:10px;margin-top:4px">Accessories: ${accessories}</div>
  `;
  preview.style.display = '';
  saveRow.style.display = '';
}

function _onSave() {
  if (!_pendingConfig) return;
  const saved = addPreset('avatars', {
    name: _pendingConfig.name || 'AI Avatar',
    config: _pendingConfig,
  });
  if (saved) {
    const customs = loadPresets('avatars');
    const last = customs[customs.length - 1];
    if (last) setActiveId('avatars', last.id);
    showToast(`Saved "${_pendingConfig.name}"`);
  } else {
    showToast('Max 20 custom avatars reached');
  }
  _onDiscard();
  _renderList();
}

function _onDiscard() {
  _pendingConfig = null;
  const preview = _container.querySelector('#avatars-preview');
  const saveRow = _container.querySelector('#avatars-save-row');
  const status = _container.querySelector('#avatars-status');
  if (preview) preview.style.display = 'none';
  if (saveRow) saveRow.style.display = 'none';
  if (status) { status.textContent = ''; status.className = 'stab-status'; }
}
