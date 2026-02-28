// src/settingsPanel.js — Settings panel controller (open/close, tabs, input blocking)

import { runMigration, deletePreset, stageUndo, executeUndo, hasUndo, clearUndo } from './settingsStorage.js';

let _overlay = null;
let _tabBar = null;
let _contentArea = null;
let _gearBtn = null;
let _toastEl = null;
let _open = false;
let _lastTab = 'themes';
const _tabs = {};
const _tabInits = {};

// ── Public API ──

export function isSettingsOpen() { return _open; }

export function initSettingsPanel() {
  runMigration();

  _overlay = document.getElementById('settings-overlay');
  _tabBar = document.getElementById('settings-tab-bar');
  _contentArea = document.getElementById('settings-content');
  _gearBtn = document.getElementById('settings-gear-btn');
  _toastEl = document.getElementById('settings-toast');

  // Gear icon
  _gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettings();
  });

  // Block all key events inside panel from reaching game
  _overlay.addEventListener('keydown', (e) => e.stopPropagation());
  _overlay.addEventListener('keyup', (e) => e.stopPropagation());

  // Close on backdrop click
  _overlay.addEventListener('click', (e) => {
    if (e.target === _overlay) closeSettings();
  });

  // ESC handler — registered on document, checked by priority in main.js
  // Tab clicks
  _tabBar.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Toast undo
  const undoBtn = _toastEl?.querySelector('.toast-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      if (executeUndo()) {
        hideToast();
        // Refresh current tab
        _refreshCurrentTab();
      }
    });
  }
}

export function openSettings() {
  if (_open) return;
  _open = true;
  _overlay.classList.add('open');
  window._blockGameInput = true;
  switchTab(_lastTab);
  _updateGearVisibility();
}

export function closeSettings() {
  if (!_open) return;
  _open = false;
  _overlay.classList.remove('open');
  window._blockGameInput = false;
  clearUndo();
  hideToast();
}

export function toggleSettings() {
  _open ? closeSettings() : openSettings();
}

export function switchTab(tabId) {
  _lastTab = tabId;

  // Update tab bar active state
  _tabBar.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Show/hide tab content
  for (const [id, el] of Object.entries(_tabs)) {
    el.style.display = id === tabId ? '' : 'none';
  }

  // Lazy-init tab if not already
  if (_tabInits[tabId] && !_tabs[tabId]._initialized) {
    _tabInits[tabId](_tabs[tabId]);
    _tabs[tabId]._initialized = true;
  }
}

// ── Tab registration (called by each tab module) ──

export function registerTab(id, container, initFn) {
  _tabs[id] = container;
  _tabInits[id] = initFn;
  _contentArea.appendChild(container);
  container.style.display = 'none';
}

// ── Toast system ──

let _toastTimer = null;

export function showToast(message, undoable = false) {
  if (!_toastEl) return;
  const textEl = _toastEl.querySelector('.toast-text');
  const undoBtn = _toastEl.querySelector('.toast-undo');
  if (textEl) textEl.textContent = message;
  if (undoBtn) undoBtn.style.display = undoable ? '' : 'none';
  _toastEl.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => hideToast(), 5000);
}

export function hideToast() {
  if (!_toastEl) return;
  _toastEl.classList.remove('visible');
  clearTimeout(_toastTimer);
}

// ── Delete helper (used by all tabs) ──

export function handlePresetDelete(category, id, name) {
  const removed = deletePreset(category, id);
  if (removed) {
    stageUndo(category, removed);
    showToast(`Deleted "${name}". Undo?`, true);
  }
  return removed;
}

// ── Gear icon visibility ──

export function updateGearVisibility() {
  _updateGearVisibility();
}

function _updateGearVisibility() {
  if (!_gearBtn) return;
  const avatarOverlay = document.getElementById('avatar-overlay');
  const gameOver = document.getElementById('game-over-overlay');
  const hidden = avatarOverlay?.classList.contains('open') || gameOver?.classList.contains('active');
  _gearBtn.style.display = hidden ? 'none' : '';
}

function _refreshCurrentTab() {
  const tab = _tabs[_lastTab];
  if (tab && tab._refresh) tab._refresh();
}
