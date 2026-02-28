// src/tabs/skinsTab.js — Skins settings tab
import { registerTab, handlePresetDelete, showToast } from '../settingsPanel.js';
import { loadPresets, addPreset, getActiveId, setActiveId } from '../settingsStorage.js';

// Built-in presets (same as PLAYER_SKIN_PRESETS in main.js)
const BUILT_IN_SKINS = [
  { id: 'neon-ranger', builtIn: true, name: 'Neon Ranger', suitColor: 0x2f7dff, accentColor: 0x9fe1ff, skinColor: 0xf5d0b0, visorColor: 0x0a2038, emissive: 0x1144aa, emissiveIntensity: 0.08 },
  { id: 'ember-guard', builtIn: true, name: 'Ember Guard', suitColor: 0xb83a2b, accentColor: 0xffa46a, skinColor: 0xf2c39f, visorColor: 0x2a1010, emissive: 0x66220f, emissiveIntensity: 0.1 },
  { id: 'jade-sentinel', builtIn: true, name: 'Jade Sentinel', suitColor: 0x1e7f62, accentColor: 0x93ffd1, skinColor: 0xe3b58f, visorColor: 0x0d2420, emissive: 0x0e4737, emissiveIntensity: 0.09 },
  { id: 'void-striker', builtIn: true, name: 'Void Striker', suitColor: 0x3a2d7a, accentColor: 0xd0b6ff, skinColor: 0xd8ae93, visorColor: 0x130d2a, emissive: 0x2b1d5a, emissiveIntensity: 0.1 },
];

let _container = null;
let _listEl = null;
let _callbacks = {};
let _generating = false;
let _abortCtrl = null;

// Called from main.js to provide skin application functions
export function setSkinsCallbacks(cbs) {
  _callbacks = cbs; // { applySkin, generateSkin, randomize }
}

export function initSkinsTab() {
  _container = document.createElement('div');
  _container.className = 'settings-tab-content';

  registerTab('skins', _container, _setup);
}

function _toHex(num) {
  return '#' + Math.max(0, Math.min(0xffffff, Math.floor(num || 0))).toString(16).padStart(6, '0');
}

function _fromHex(str) {
  return parseInt((str || '#ffffff').replace('#', ''), 16);
}

function _setup() {
  _container.innerHTML = `
    <div class="stab-section">
      <div class="stab-section-title">Skin Presets</div>
      <div class="stab-preset-grid" id="skins-preset-list"></div>
    </div>
    <div class="stab-section">
      <div class="stab-section-title">Manual Colors</div>
      <div class="stab-color-row" id="skins-colors">
        <label>Suit <input type="color" id="skins-suit" value="#2f7dff" /></label>
        <label>Accent <input type="color" id="skins-accent" value="#9fe1ff" /></label>
        <label>Skin <input type="color" id="skins-tone" value="#f5d0b0" /></label>
        <label>Visor <input type="color" id="skins-visor" value="#0a2038" /></label>
      </div>
      <div class="stab-btn-row">
        <button class="stab-btn-secondary" id="skins-save-manual-btn">Save as Preset</button>
        <button class="stab-btn-secondary" id="skins-randomize-btn">Randomize</button>
      </div>
    </div>
    <div class="stab-section">
      <div class="stab-section-title">AI Generate</div>
      <div class="stab-generate">
        <input class="stab-input" id="skins-prompt" placeholder="e.g. batman, molten lava warrior..." maxlength="80" />
        <div class="stab-btn-row">
          <button class="stab-btn-primary" id="skins-generate-btn">Generate Skin</button>
        </div>
        <div class="stab-status" id="skins-status"></div>
        <div class="stab-preview" id="skins-preview" style="display:none"></div>
        <div class="stab-btn-row" id="skins-save-row" style="display:none">
          <button class="stab-btn-primary" id="skins-save-ai-btn">Save Skin</button>
          <button class="stab-btn-secondary" id="skins-discard-btn">Discard</button>
        </div>
      </div>
    </div>
  `;

  _listEl = _container.querySelector('#skins-preset-list');

  // Color pickers — apply live
  ['skins-suit', 'skins-accent', 'skins-tone', 'skins-visor'].forEach(id => {
    _container.querySelector(`#${id}`).addEventListener('input', _applyManualColors);
  });

  _container.querySelector('#skins-save-manual-btn').addEventListener('click', _saveManual);
  _container.querySelector('#skins-randomize-btn').addEventListener('click', _randomize);
  _container.querySelector('#skins-generate-btn').addEventListener('click', _onGenerate);
  _container.querySelector('#skins-save-ai-btn')?.addEventListener('click', _saveAi);
  _container.querySelector('#skins-discard-btn')?.addEventListener('click', _discardAi);

  _container._refresh = _renderList;
  _renderList();
}

let _pendingSkin = null;

function _renderList() {
  if (!_listEl) return;
  const customs = loadPresets('skins');
  const activeId = getActiveId('skins') || 'neon-ranger';
  const all = [...BUILT_IN_SKINS, ...customs];

  _listEl.innerHTML = '';
  for (const skin of all) {
    const card = document.createElement('div');
    card.className = 'stab-preset-card' + (skin.id === activeId ? ' active' : '');

    const colors = [
      _toHex(skin.suitColor),
      _toHex(skin.accentColor),
      _toHex(skin.visorColor),
    ];

    card.innerHTML = `
      <div class="stab-color-strip">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
      <div class="preset-name">${skin.name || 'Unnamed'}</div>
      ${!skin.builtIn ? '<button class="preset-delete" title="Delete">&#10005;</button>' : ''}
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('preset-delete')) return;
      _applySkin(skin);
      setActiveId('skins', skin.id);
      _syncColorPickers(skin);
      _renderList();
    });

    const delBtn = card.querySelector('.preset-delete');
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePresetDelete('skins', skin.id, skin.name);
        _renderList();
      });
    }

    _listEl.appendChild(card);
  }
}

function _applySkin(skin) {
  if (_callbacks.applySkin) {
    _callbacks.applySkin({
      presetId: skin.id || 'custom',
      presetName: skin.name,
      suitColor: skin.suitColor,
      accentColor: skin.accentColor,
      skinColor: skin.skinColor,
      visorColor: skin.visorColor,
      emissive: skin.emissive,
      emissiveIntensity: skin.emissiveIntensity,
    });
  }
}

function _syncColorPickers(skin) {
  const c = _container;
  if (!c) return;
  const set = (id, val) => { const el = c.querySelector(`#${id}`); if (el) el.value = _toHex(val); };
  set('skins-suit', skin.suitColor);
  set('skins-accent', skin.accentColor);
  set('skins-tone', skin.skinColor);
  set('skins-visor', skin.visorColor);
}

function _applyManualColors() {
  const c = _container;
  const skin = {
    presetId: 'custom',
    presetName: 'Custom',
    suitColor: _fromHex(c.querySelector('#skins-suit').value),
    accentColor: _fromHex(c.querySelector('#skins-accent').value),
    skinColor: _fromHex(c.querySelector('#skins-tone').value),
    visorColor: _fromHex(c.querySelector('#skins-visor').value),
    emissive: _fromHex(c.querySelector('#skins-suit').value),
    emissiveIntensity: 0.08,
  };
  _applySkin(skin);
}

function _saveManual() {
  const c = _container;
  const name = prompt('Name this skin preset:') || 'Custom Skin';
  const saved = addPreset('skins', {
    name,
    suitColor: _fromHex(c.querySelector('#skins-suit').value),
    accentColor: _fromHex(c.querySelector('#skins-accent').value),
    skinColor: _fromHex(c.querySelector('#skins-tone').value),
    visorColor: _fromHex(c.querySelector('#skins-visor').value),
    emissive: _fromHex(c.querySelector('#skins-suit').value),
    emissiveIntensity: 0.08,
  });
  if (saved) {
    showToast(`Saved "${name}"`);
    _renderList();
  } else {
    showToast('Max 20 custom skins reached');
  }
}

function _randomize() {
  const rand = () => Math.floor(Math.random() * 0xffffff);
  const skin = {
    presetId: 'custom',
    presetName: 'Random',
    suitColor: rand(),
    accentColor: rand(),
    skinColor: 0xf5d0b0,
    visorColor: rand(),
    emissive: rand(),
    emissiveIntensity: 0.08 + Math.random() * 0.06,
  };
  _applySkin(skin);
  _syncColorPickers(skin);
}

async function _onGenerate() {
  if (_generating) return;
  _generating = true;
  const btn = _container.querySelector('#skins-generate-btn');
  const status = _container.querySelector('#skins-status');
  const prompt = _container.querySelector('#skins-prompt').value.trim();
  if (!prompt) { _generating = false; return; }

  btn.disabled = true;
  status.textContent = 'Generating skin...';
  status.className = 'stab-status loading';

  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();

  try {
    let skin = null;
    if (_callbacks.generateSkin) {
      skin = await _callbacks.generateSkin(prompt, _abortCtrl.signal);
    }

    if (skin) {
      _pendingSkin = skin;
      _applySkin(skin);
      _syncColorPickers(skin);
      _showPreview(skin);
      status.textContent = 'Skin applied — save or discard';
      status.className = 'stab-status success';
    } else {
      status.textContent = 'Generation failed';
      status.className = 'stab-status error';
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      status.textContent = 'Generation failed';
      status.className = 'stab-status error';
    }
  }

  btn.disabled = false;
  _generating = false;
}

function _showPreview(skin) {
  const preview = _container.querySelector('#skins-preview');
  const saveRow = _container.querySelector('#skins-save-row');
  const colors = [_toHex(skin.suitColor), _toHex(skin.accentColor), _toHex(skin.visorColor)];
  preview.innerHTML = `
    <div class="stab-color-strip">${colors.map(c => `<span style="background:${c}"></span>`).join('')}</div>
    <div style="font-weight:bold;margin-top:6px">${skin.presetName || 'AI Skin'}</div>
  `;
  preview.style.display = '';
  saveRow.style.display = '';
}

function _saveAi() {
  if (!_pendingSkin) return;
  const name = _pendingSkin.presetName || 'AI Skin';
  const saved = addPreset('skins', {
    name,
    suitColor: _pendingSkin.suitColor,
    accentColor: _pendingSkin.accentColor,
    skinColor: _pendingSkin.skinColor,
    visorColor: _pendingSkin.visorColor,
    emissive: _pendingSkin.emissive,
    emissiveIntensity: _pendingSkin.emissiveIntensity,
  });
  if (saved) {
    const customs = loadPresets('skins');
    const last = customs[customs.length - 1];
    if (last) setActiveId('skins', last.id);
    showToast(`Saved "${name}"`);
  } else {
    showToast('Max 20 custom skins reached');
  }
  _discardAi();
  _renderList();
}

function _discardAi() {
  _pendingSkin = null;
  const preview = _container.querySelector('#skins-preview');
  const saveRow = _container.querySelector('#skins-save-row');
  const status = _container.querySelector('#skins-status');
  if (preview) preview.style.display = 'none';
  if (saveRow) saveRow.style.display = 'none';
  if (status) { status.textContent = ''; status.className = 'stab-status'; }
}
