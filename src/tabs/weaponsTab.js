// src/tabs/weaponsTab.js — Weapons settings tab
import { registerTab, handlePresetDelete, showToast } from '../settingsPanel.js';
import { loadWeapons } from '../weaponStorage.js';
import { openForge } from '../forge.js';

let _container = null;
let _listEl = null;

export function initWeaponsTab() {
  _container = document.createElement('div');
  _container.className = 'settings-tab-content';

  registerTab('weapons', _container, _setup);
}

function _setup() {
  _container.innerHTML = `
    <div class="stab-section">
      <div class="stab-section-title">Weapon Slots</div>
      <div class="stab-preset-grid" id="weapons-slot-list"></div>
    </div>
    <div class="stab-section">
      <div class="stab-section-title">Forge New Weapon</div>
      <div class="stab-generate">
        <p style="color:#888;font-size:11px;margin:0">Use the Weapon Forge to create AI-generated weapons from text descriptions.</p>
        <button class="stab-btn-primary" id="weapons-open-forge-btn">Open Weapon Forge (T)</button>
      </div>
    </div>
  `;

  _listEl = _container.querySelector('#weapons-slot-list');
  _container.querySelector('#weapons-open-forge-btn').addEventListener('click', () => {
    import('../settingsPanel.js').then(mod => {
      mod.closeSettings();
      setTimeout(() => openForge(), 100);
    });
  });

  _container._refresh = _renderList;
  _renderList();
}

function _renderList() {
  if (!_listEl) return;
  const weapons = loadWeapons();
  _listEl.innerHTML = '';

  for (let i = 0; i < 4; i++) {
    const w = weapons.find(slot => slot && slot.slotIndex === i);
    const card = document.createElement('div');
    card.className = 'stab-preset-card' + (w ? '' : '');

    if (w) {
      card.innerHTML = `
        <div class="preset-name">Slot ${i + 1}: ${w.prompt || 'Unnamed Weapon'}</div>
        <div class="preset-info" style="margin-top:4px;max-height:40px;overflow:hidden;word-break:break-all;color:#666;font-size:9px">${(w.code || '').slice(0, 80)}...</div>
      `;
    } else {
      card.innerHTML = `
        <div class="preset-name" style="color:#555">Slot ${i + 1}: Empty</div>
        <div class="preset-info">Forge a weapon to fill this slot</div>
      `;
    }

    _listEl.appendChild(card);
  }
}
