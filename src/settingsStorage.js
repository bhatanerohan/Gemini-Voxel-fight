// src/settingsStorage.js — Unified localStorage CRUD for settings panel

const KEYS = {
  themes: 'voxel-settings.themes',
  weapons: 'voxel-settings.weapons',
  skins: 'voxel-settings.skins',
  avatars: 'voxel-settings.avatars',
  graphics: 'voxel-settings.graphics',
  activeTheme: 'voxel-settings.themes.active',
  activeSkin: 'voxel-settings.skins.active',
  activeAvatar: 'voxel-settings.avatars.active',
};

const MAX_CUSTOM_PRESETS = 20;

// ── Old keys for migration ──
const OLD_KEYS = {
  weapons: 'voxel-weapons',
  skins: 'voxel-arena.player-skin.v1',
};

// ── Generic helpers ──

function _read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn(`[settingsStorage] Failed to read ${key}:`, e);
    return null;
  }
}

function _write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`[settingsStorage] Failed to write ${key}:`, e);
    return false;
  }
}

function _remove(key) {
  try { localStorage.removeItem(key); } catch (_) { /* noop */ }
}

// ── Preset CRUD ──

export function loadPresets(category) {
  return _read(KEYS[category]) || [];
}

export function savePresets(category, data) {
  _write(KEYS[category], data);
}

export function addPreset(category, preset) {
  const list = loadPresets(category);
  const customCount = list.filter(p => !p.builtIn).length;
  if (customCount >= MAX_CUSTOM_PRESETS) {
    console.warn(`[settingsStorage] Max ${MAX_CUSTOM_PRESETS} custom presets for ${category}`);
    return false;
  }
  preset.id = preset.id || _generateId();
  preset.builtIn = false;
  preset.createdAt = Date.now();
  list.push(preset);
  _write(KEYS[category], list);
  return true;
}

export function deletePreset(category, id) {
  const list = loadPresets(category);
  const idx = list.findIndex(p => p.id === id && !p.builtIn);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  _write(KEYS[category], list);
  return removed;
}

export function getCustomPresetCount(category) {
  return loadPresets(category).filter(p => !p.builtIn).length;
}

// ── Active selection ──

export function getActiveId(category) {
  return _read(KEYS[`active${_cap(category)}`]) || null;
}

export function setActiveId(category, id) {
  const key = KEYS[`active${_cap(category)}`];
  if (key) _write(key, id);
}

function _cap(s) {
  // themes → Theme, skins → Skin, avatars → Avatar
  const base = s.endsWith('s') ? s.slice(0, -1) : s;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

// ── Graphics settings ──

const DEFAULT_GRAPHICS = {
  bloomStrength: null,  // null = use theme default
  bloomRadius: null,
  bloomThreshold: null,
  fogDensity: null,
  particleDensity: 0.5,
  showFps: false,
};

export function getGraphicsSettings() {
  return { ...DEFAULT_GRAPHICS, ...(_read(KEYS.graphics) || {}) };
}

export function saveGraphicsSettings(settings) {
  _write(KEYS.graphics, settings);
}

// ── Migration ──

let _migrated = false;

export function runMigration() {
  if (_migrated) return;
  _migrated = true;

  // Migrate weapons
  if (!_read(KEYS.weapons)) {
    const oldWeapons = _read(OLD_KEYS.weapons);
    if (oldWeapons && Array.isArray(oldWeapons)) {
      _write(KEYS.weapons, oldWeapons.map(w => w ? { ...w, builtIn: false, id: _generateId() } : null).filter(Boolean));
      _remove(OLD_KEYS.weapons);
    }
  }

  // Migrate skin config → skins active selection
  if (!_read(KEYS.activeSkin)) {
    const oldSkin = _read(OLD_KEYS.skins);
    if (oldSkin && oldSkin.presetId) {
      _write(KEYS.activeSkin, oldSkin.presetId);
      // Also save it as a custom preset if it was custom
      if (oldSkin.presetId === 'custom') {
        addPreset('skins', {
          name: oldSkin.presetName || 'Migrated Skin',
          suitColor: oldSkin.suitColor,
          accentColor: oldSkin.accentColor,
          skinColor: oldSkin.skinColor,
          visorColor: oldSkin.visorColor,
          emissive: oldSkin.emissive,
          emissiveIntensity: oldSkin.emissiveIntensity,
        });
      }
    }
  }
}

// ── Undo support ──

let _undoBuffer = null;
let _undoTimer = null;

export function stageUndo(category, preset) {
  clearUndo();
  _undoBuffer = { category, preset };
  _undoTimer = setTimeout(() => { _undoBuffer = null; }, 5000);
}

export function executeUndo() {
  if (!_undoBuffer) return false;
  const { category, preset } = _undoBuffer;
  const list = loadPresets(category);
  list.push(preset);
  _write(KEYS[category], list);
  clearUndo();
  return true;
}

export function clearUndo() {
  if (_undoTimer) clearTimeout(_undoTimer);
  _undoBuffer = null;
  _undoTimer = null;
}

export function hasUndo() {
  return !!_undoBuffer;
}

// ── Utilities ──

function _generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
