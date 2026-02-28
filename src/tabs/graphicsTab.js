// src/tabs/graphicsTab.js — Graphics settings tab
import { registerTab } from '../settingsPanel.js';
import { getGraphicsSettings, saveGraphicsSettings } from '../settingsStorage.js';

let _container = null;
let _sceneRefs = null;
let _settings = null;

export function setGraphicsSceneRefs(refs) {
  _sceneRefs = refs;
}

export function initGraphicsTab() {
  _container = document.createElement('div');
  _container.className = 'settings-tab-content';

  registerTab('graphics', _container, _setup);
}

// Called externally when theme changes to sync sliders
export function syncGraphicsSlidersToScene() {
  if (!_container || !_container._initialized || !_sceneRefs) return;
  const r = _sceneRefs;
  _setSlider('bloom-strength', r.bloomPass?.strength ?? 1.0);
  _setSlider('bloom-radius', r.bloomPass?.radius ?? 0.4);
  _setSlider('bloom-threshold', r.bloomPass?.threshold ?? 0.25);
  _setSlider('fog-density', r.scene?.fog?.density ?? 0.01);
}

function _setup() {
  _settings = getGraphicsSettings();

  _container.innerHTML = `
    <div class="stab-section">
      <div class="stab-section-title">Bloom</div>
      ${_slider('bloom-strength', 'Intensity', 0, 2.5, 0.1)}
      ${_slider('bloom-radius', 'Radius', 0, 1, 0.05)}
      ${_slider('bloom-threshold', 'Threshold', 0, 1, 0.05)}
    </div>
    <div class="stab-section">
      <div class="stab-section-title">Environment</div>
      ${_slider('fog-density', 'Fog Density', 0, 0.05, 0.001)}
      ${_slider('particle-density', 'Particle Density', 0, 1, 0.1)}
    </div>
    <div class="stab-section">
      <div class="stab-section-title">Display</div>
      <label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#aaa;cursor:pointer">
        <input type="checkbox" id="gfx-show-fps" ${_settings.showFps ? 'checked' : ''} />
        Show FPS Counter
      </label>
    </div>
    <div class="stab-section" style="margin-top:16px">
      <button class="stab-btn-secondary" id="gfx-reset-btn">Reset to Theme Defaults</button>
    </div>
  `;

  // Initialize slider values from scene or saved settings
  _initSliderValues();

  // Wire up all range inputs
  _container.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      _onSliderChange(input.id, parseFloat(input.value));
      const valEl = input.parentElement.querySelector('.slider-value');
      if (valEl) valEl.textContent = input.value;
    });
  });

  // FPS toggle
  _container.querySelector('#gfx-show-fps')?.addEventListener('change', (e) => {
    _settings.showFps = e.target.checked;
    _save();
    _toggleFpsDisplay(_settings.showFps);
  });

  // Reset button
  _container.querySelector('#gfx-reset-btn')?.addEventListener('click', () => {
    syncGraphicsSlidersToScene();
    _settings = { ...getGraphicsSettings(), bloomStrength: null, bloomRadius: null, bloomThreshold: null, fogDensity: null };
    _save();
  });

  _container._refresh = () => _initSliderValues();
}

function _slider(id, label, min, max, step) {
  return `
    <div class="stab-slider-row">
      <label>${label}</label>
      <input type="range" id="gfx-${id}" min="${min}" max="${max}" step="${step}" value="${min}" />
      <span class="slider-value">${min}</span>
    </div>
  `;
}

function _setSlider(id, value) {
  const input = _container?.querySelector(`#gfx-${id}`);
  if (!input) return;
  input.value = value;
  const valEl = input.parentElement?.querySelector('.slider-value');
  if (valEl) valEl.textContent = parseFloat(value).toFixed(id === 'fog-density' ? 3 : 2);
}

function _initSliderValues() {
  if (!_sceneRefs) return;
  const r = _sceneRefs;
  const s = _settings;

  _setSlider('bloom-strength', s.bloomStrength ?? r.bloomPass?.strength ?? 1.0);
  _setSlider('bloom-radius', s.bloomRadius ?? r.bloomPass?.radius ?? 0.4);
  _setSlider('bloom-threshold', s.bloomThreshold ?? r.bloomPass?.threshold ?? 0.25);
  _setSlider('fog-density', s.fogDensity ?? r.scene?.fog?.density ?? 0.01);
  _setSlider('particle-density', s.particleDensity ?? 0.5);
}

function _onSliderChange(id, value) {
  if (!_sceneRefs) return;
  const r = _sceneRefs;

  switch (id) {
    case 'gfx-bloom-strength':
      if (r.bloomPass) r.bloomPass.strength = value;
      _settings.bloomStrength = value;
      break;
    case 'gfx-bloom-radius':
      if (r.bloomPass) r.bloomPass.radius = value;
      _settings.bloomRadius = value;
      break;
    case 'gfx-bloom-threshold':
      if (r.bloomPass) r.bloomPass.threshold = value;
      _settings.bloomThreshold = value;
      break;
    case 'gfx-fog-density':
      if (r.scene?.fog) r.scene.fog.density = value;
      _settings.fogDensity = value;
      break;
    case 'gfx-particle-density':
      _settings.particleDensity = value;
      break;
  }

  _save();
}

function _save() {
  saveGraphicsSettings(_settings);
}

function _toggleFpsDisplay(show) {
  let el = document.getElementById('fps-counter');
  if (show && !el) {
    el = document.createElement('div');
    el.id = 'fps-counter';
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:20;color:#0f0;font-family:monospace;font-size:11px;pointer-events:none;background:rgba(0,0,0,0.4);padding:2px 8px;border-radius:4px';
    document.body.appendChild(el);
    let lastTime = performance.now();
    let frames = 0;
    (function tick() {
      frames++;
      const now = performance.now();
      if (now - lastTime >= 500) {
        el.textContent = `${Math.round(frames / ((now - lastTime) / 1000))} FPS`;
        frames = 0;
        lastTime = now;
      }
      if (document.getElementById('fps-counter')) requestAnimationFrame(tick);
    })();
  } else if (!show && el) {
    el.remove();
  }
}

// Apply saved graphics settings on game init
export function applyStoredGraphicsSettings(refs) {
  _sceneRefs = refs;
  const s = getGraphicsSettings();

  if (s.bloomStrength !== null && refs.bloomPass) refs.bloomPass.strength = s.bloomStrength;
  if (s.bloomRadius !== null && refs.bloomPass) refs.bloomPass.radius = s.bloomRadius;
  if (s.bloomThreshold !== null && refs.bloomPass) refs.bloomPass.threshold = s.bloomThreshold;
  if (s.fogDensity !== null && refs.scene?.fog) refs.scene.fog.density = s.fogDensity;
  if (s.showFps) _toggleFpsDisplay(true);
}
