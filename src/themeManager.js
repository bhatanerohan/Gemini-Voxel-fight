// src/themeManager.js — Unified theme system with presets + AI generation
import * as THREE from 'three';
import { geminiJSON } from './geminiService.js';

// ── Presets ──
export const PRESETS = {
  neon: {
    name: 'Neon Arena',
    background: '#0a0a2e', fog: { color: '#0a0a2e', density: 0.01 },
    ground: '#141435', grid: { color: '#2a2a66', opacity: 0.4 },
    cover: '#2a2a55', platform: '#333366',
    accent: { color: '#0066ff', emissive: '#003399' },
    boundary: { color: '#00ccff', emissive: '#0066aa' },
    lighting: {
      ambient: { color: '#334466', intensity: 0.7 },
      sun: { color: '#aaccff', intensity: 0.9 },
      hemisphere: { sky: '#4488ff', ground: '#221133', intensity: 0.4 },
    },
    bloom: { strength: 1.2, radius: 0.4, threshold: 0.25 },
    hud: { primary: '#00ffff', secondary: '#aaeeff', glow: 'rgba(0,255,255,0.5)', bg: 'rgba(0,255,255,0.1)' },
  },
  scorched: {
    name: 'Scorched Earth',
    background: '#1a0800', fog: { color: '#2a1000', density: 0.015 },
    ground: '#1a0e05', grid: { color: '#3a2010', opacity: 0.3 },
    cover: '#3a2820', platform: '#4a3020',
    accent: { color: '#ff4400', emissive: '#882200' },
    boundary: { color: '#ff6600', emissive: '#aa3300' },
    lighting: {
      ambient: { color: '#442211', intensity: 0.6 },
      sun: { color: '#ffaa44', intensity: 1.2 },
      hemisphere: { sky: '#ff6633', ground: '#331100', intensity: 0.35 },
    },
    bloom: { strength: 0.9, radius: 0.3, threshold: 0.3 },
    hud: { primary: '#ff6600', secondary: '#ffcc88', glow: 'rgba(255,102,0,0.5)', bg: 'rgba(255,102,0,0.1)' },
  },
  arctic: {
    name: 'Arctic Void',
    background: '#0c1520', fog: { color: '#0e1825', density: 0.008 },
    ground: '#1a2535', grid: { color: '#3a5570', opacity: 0.3 },
    cover: '#2a3a50', platform: '#354a60',
    accent: { color: '#44aacc', emissive: '#225566' },
    boundary: { color: '#66ddff', emissive: '#3388aa' },
    lighting: {
      ambient: { color: '#445566', intensity: 0.8 },
      sun: { color: '#ddeeff', intensity: 1.1 },
      hemisphere: { sky: '#88bbdd', ground: '#112233', intensity: 0.4 },
    },
    bloom: { strength: 0.5, radius: 0.2, threshold: 0.4 },
    hud: { primary: '#66ddff', secondary: '#bbddee', glow: 'rgba(102,221,255,0.5)', bg: 'rgba(102,221,255,0.1)' },
  },
};

// ── State ──
let _refs = null;
let _currentName = 'neon';
let _lerpRAF = null;
let _abortCtrl = null;
let _gameContext = {};

// ── Game context for AI theme generation ──
export function setGameContext(ctx) {
  _gameContext = { ..._gameContext, ...ctx };
}

// ── Clamping ranges ──
const CLAMP = {
  intensity: [0.3, 2.0],
  fogDensity: [0.005, 0.03],
  bloomStrength: [0.3, 2.5],
  bloomRadius: [0.1, 1.0],
  bloomThreshold: [0.1, 0.8],
  gridOpacity: [0.1, 0.6],
};

function clamp(v, [min, max]) { return Math.max(min, Math.min(max, v)); }

function isValidHex(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function hexToColor(hex) {
  return new THREE.Color(hex);
}

// Derive HUD colors from a primary hex if AI didn't provide them
function _deriveHudFromPrimary(primaryHex) {
  const c = new THREE.Color(primaryHex);
  const hsl = {};
  c.getHSL(hsl);
  const secondary = new THREE.Color().setHSL(hsl.h, Math.max(0.2, hsl.s * 0.6), Math.min(0.9, hsl.l + 0.25));
  const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
  return {
    primary: primaryHex,
    secondary: '#' + secondary.getHexString(),
    glow: `rgba(${r},${g},${b},0.5)`,
    bg: `rgba(${r},${g},${b},0.1)`,
  };
}

function _validateHud(rawHud, boundaryColor) {
  if (rawHud && isValidHex(rawHud.primary)) {
    const hud = _deriveHudFromPrimary(rawHud.primary);
    // Use AI-provided secondary if valid, otherwise derive
    if (isValidHex(rawHud.secondary)) hud.secondary = rawHud.secondary;
    return hud;
  }
  // Derive from boundary color (the brightest scene element)
  return _deriveHudFromPrimary(isValidHex(boundaryColor) ? boundaryColor : '#00ffff');
}

function _applyHudColors(hud) {
  const root = document.documentElement;
  root.style.setProperty('--hud-primary', hud.primary);
  root.style.setProperty('--hud-secondary', hud.secondary);
  root.style.setProperty('--hud-glow', hud.glow);
  root.style.setProperty('--hud-bg', hud.bg);
}

// ── Init ──
export function initThemeManager(sceneRefs) {
  _refs = sceneRefs;
}

// ── Validate & clamp AI-generated theme config ──
export function validateThemeConfig(raw) {
  const fallback = PRESETS.neon;
  if (!raw || typeof raw !== 'object') return { ...fallback };

  const hex = (val, fb) => isValidHex(val) ? val : fb;
  const num = (val, range, fb) => typeof val === 'number' ? clamp(val, range) : fb;

  return {
    name: typeof raw.name === 'string' ? raw.name.slice(0, 40) : 'AI Theme',
    background: hex(raw.background, fallback.background),
    fog: {
      color: hex(raw.fog?.color, fallback.fog.color),
      density: num(raw.fog?.density, CLAMP.fogDensity, fallback.fog.density),
    },
    ground: hex(raw.ground, fallback.ground),
    grid: {
      color: hex(raw.grid?.color, fallback.grid.color),
      opacity: num(raw.grid?.opacity, CLAMP.gridOpacity, fallback.grid.opacity),
    },
    cover: hex(raw.cover, fallback.cover),
    platform: hex(raw.platform, fallback.platform),
    accent: {
      color: hex(raw.accent?.color, fallback.accent.color),
      emissive: hex(raw.accent?.emissive, fallback.accent.emissive),
    },
    boundary: {
      color: hex(raw.boundary?.color, fallback.boundary.color),
      emissive: hex(raw.boundary?.emissive, fallback.boundary.emissive),
    },
    lighting: {
      ambient: {
        color: hex(raw.lighting?.ambient?.color, fallback.lighting.ambient.color),
        intensity: num(raw.lighting?.ambient?.intensity, CLAMP.intensity, fallback.lighting.ambient.intensity),
      },
      sun: {
        color: hex(raw.lighting?.sun?.color, fallback.lighting.sun.color),
        intensity: num(raw.lighting?.sun?.intensity, CLAMP.intensity, fallback.lighting.sun.intensity),
      },
      hemisphere: {
        sky: hex(raw.lighting?.hemisphere?.sky, fallback.lighting.hemisphere.sky),
        ground: hex(raw.lighting?.hemisphere?.ground, fallback.lighting.hemisphere.ground),
        intensity: num(raw.lighting?.hemisphere?.intensity, CLAMP.intensity, fallback.lighting.hemisphere.intensity),
      },
    },
    bloom: {
      strength: num(raw.bloom?.strength, CLAMP.bloomStrength, fallback.bloom.strength),
      radius: num(raw.bloom?.radius, CLAMP.bloomRadius, fallback.bloom.radius),
      threshold: num(raw.bloom?.threshold, CLAMP.bloomThreshold, fallback.bloom.threshold),
    },
    hud: _validateHud(raw.hud, raw.boundary?.color || fallback.boundary.color),
  };
}

// ── Apply theme instantly (no lerp) ──
export function applyThemeInstant(config) {
  if (!_refs) return;
  _cancelLerp();
  _applyConfigToScene(config);
  _currentName = config.name || 'custom';
}

// ── Apply theme with smooth ~1s lerp transition ──
export function applyTheme(config) {
  if (!_refs) return;
  _cancelLerp();

  const from = _snapshotScene();
  const to = config;
  _currentName = config.name || 'custom';

  // Apply HUD colors immediately (CSS transitions handle the smoothness)
  if (config.hud) _applyHudColors(config.hud);

  const duration = 1000; // ms
  const start = performance.now();

  function tick() {
    const t = Math.min(1, (performance.now() - start) / duration);
    const ease = t * (2 - t); // ease-out quad
    _lerpScene(from, to, ease);
    if (t < 1) {
      _lerpRAF = requestAnimationFrame(tick);
    } else {
      _lerpRAF = null;
    }
  }
  _lerpRAF = requestAnimationFrame(tick);
}

// ── Generate AI theme via Gemini ──
export async function generateTheme(hint) {
  // Abort any previous in-flight request
  if (_abortCtrl) _abortCtrl.abort();
  _abortCtrl = new AbortController();

  const schemaExample = JSON.stringify(PRESETS.neon, null, 2);

  // Build context block from current game state
  let contextBlock = '';
  if (_gameContext.arenaTheme) {
    const at = _gameContext.arenaTheme;
    contextBlock = `
CURRENT ENVIRONMENT (your theme must complement this):
- Arena: "${at.name || 'Unknown Arena'}"
- Arena floor: ${at.floorColor || 'unknown'}, walls: ${at.wallColor || 'unknown'}, fog: ${at.fogColor || 'unknown'}
- Sky gradient: ${at.skyTop || 'unknown'} (zenith) → ${at.skyHorizon || 'unknown'} (horizon) → ${at.skyBottom || 'unknown'} (below)
- Player avatar: "${_gameContext.avatarConcept || 'Unknown Fighter'}" with colors: primary ${_gameContext.avatarColors?.primary || '?'}, accent ${_gameContext.avatarColors?.accent || '?'}
- Current wave: ${_gameContext.wave || 1}
- Currently applied theme: "${_currentName}"
`;
  }

  const systemPrompt = `You are a JSON-only API that outputs color themes for a 3D voxel arena shooter game.
You MUST respond with ONLY a single valid JSON object. No markdown, no code fences, no explanation.

The JSON must match this exact schema (all colors as "#rrggbb" hex strings):
${schemaExample}
${contextBlock}
COLOR HARMONY RULES (follow these strictly):
- background and fog.color should be similar hues for atmospheric coherence
- ground should be a darker shade of background (30-50% darker)
- cover and platform should be mid-tones between ground and background
- accent.color and boundary.color should be the brightest, most saturated — these are the visual "pop"
- accent.emissive should be a darker, more saturated version of accent.color
- boundary.emissive should be a darker version of boundary.color
- lighting.ambient.color should be a desaturated tint of the background
- lighting.sun.color should complement the accent (warm accent → cool sun, cool accent → warm sun)
- lighting.hemisphere.sky should match or complement the background hue
- bloom.strength: higher (1.2-1.8) for neon/energy themes, lower (0.4-0.8) for natural/organic themes
- hud.primary is the main HUD text color — must be bright and readable against dark backgrounds
- hud.primary should match or complement the boundary/accent color family

MOOD REFERENCE:
- Neon/Cyber: deep blues/purples + bright cyan/magenta accents, high bloom
- Hellfire/Volcanic: deep reds/blacks + bright orange/yellow accents, medium bloom
- Arctic/Frost: deep blue-greys + bright cyan/white accents, low bloom
- Nature/Organic: deep greens/browns + bright emerald/gold accents, low bloom
- Void/Eldritch: deep purples/blacks + bright violet/magenta accents, high bloom
- Sacred/Holy: deep navy/indigo + bright gold/white accents, medium bloom
- Toxic/Acid: deep dark greens + bright lime/yellow accents, medium bloom

CRITICAL RULES:
- Your theme must feel like it BELONGS in the current arena. Complement the environment, don't clash.
- Background and fog must be DARK enough for players to see enemies (max brightness ~30%)
- Boundary and accent must be BRIGHT/emissive to stand out against dark backgrounds
- Give the theme a creative, evocative 2-4 word name
- Output ONLY the JSON object`;

  const userMessage = hint
    ? `Create a theme inspired by: "${hint}"`
    : 'Create a surprising, creative arena theme that complements the current environment. Be bold and imaginative.';

  try {
    const raw = await geminiJSON({
      systemPrompt,
      userMessage,
      temperature: 0.9,
      maxTokens: 4096,
      signal: _abortCtrl.signal,
    });
    if (!raw) return null;
    return validateThemeConfig(raw);
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.warn('[themeManager] generateTheme error:', err.message);
    return null;
  }
}

export function getCurrentThemeName() {
  return _currentName;
}

// ── Internal helpers ──

function _cancelLerp() {
  if (_lerpRAF) {
    cancelAnimationFrame(_lerpRAF);
    _lerpRAF = null;
  }
}

function _snapshotScene() {
  const r = _refs;
  return {
    background: r.scene.background ? '#' + r.scene.background.getHexString() : '#000000',
    fog: {
      color: '#' + r.scene.fog.color.getHexString(),
      density: r.scene.fog.density,
    },
    ground: '#' + r.groundMesh.material.color.getHexString(),
    grid: {
      color: '#' + (r.gridHelper.material.color
        ? r.gridHelper.material.color.getHexString()
        : '2a2a66'),
      opacity: r.gridHelper.material.opacity,
    },
    cover: '#' + r.coverMat.color.getHexString(),
    platform: '#' + r.platformMat.color.getHexString(),
    accent: {
      color: '#' + r.accentMat.color.getHexString(),
      emissive: '#' + r.accentMat.emissive.getHexString(),
    },
    boundary: {
      color: '#' + r.boundaryMat.color.getHexString(),
      emissive: '#' + r.boundaryMat.emissive.getHexString(),
    },
    lighting: {
      ambient: { color: '#' + r.ambientLight.color.getHexString(), intensity: r.ambientLight.intensity },
      sun: { color: '#' + r.sunLight.color.getHexString(), intensity: r.sunLight.intensity },
      hemisphere: {
        sky: '#' + r.hemiLight.color.getHexString(),
        ground: '#' + r.hemiLight.groundColor.getHexString(),
        intensity: r.hemiLight.intensity,
      },
    },
    bloom: r.bloomPass
      ? { strength: r.bloomPass.strength, radius: r.bloomPass.radius, threshold: r.bloomPass.threshold }
      : { strength: 0.8, radius: 0.3, threshold: 0.3 },
  };
}

const _tmpFrom = new THREE.Color();
const _tmpTo = new THREE.Color();

function _lerpColor(target, fromHex, toHex, t) {
  _tmpFrom.set(fromHex);
  _tmpTo.set(toHex);
  _tmpFrom.lerp(_tmpTo, t);
  target.copy(_tmpFrom);
}

function _lerp(a, b, t) { return a + (b - a) * t; }

function _lerpScene(from, to, t) {
  const r = _refs;

  if (!r.scene.background) r.scene.background = new THREE.Color();
  _lerpColor(r.scene.background, from.background, to.background, t);
  _lerpColor(r.scene.fog.color, from.fog.color, to.fog.color, t);
  r.scene.fog.density = _lerp(from.fog.density, to.fog.density, t);

  _lerpColor(r.groundMesh.material.color, from.ground, to.ground, t);

  if (r.gridHelper.material.color) {
    _lerpColor(r.gridHelper.material.color, from.grid.color, to.grid.color, t);
  }
  r.gridHelper.material.opacity = _lerp(from.grid.opacity, to.grid.opacity, t);

  _lerpColor(r.coverMat.color, from.cover, to.cover, t);
  _lerpColor(r.platformMat.color, from.platform, to.platform, t);

  _lerpColor(r.accentMat.color, from.accent.color, to.accent.color, t);
  _lerpColor(r.accentMat.emissive, from.accent.emissive, to.accent.emissive, t);

  _lerpColor(r.boundaryMat.color, from.boundary.color, to.boundary.color, t);
  _lerpColor(r.boundaryMat.emissive, from.boundary.emissive, to.boundary.emissive, t);

  _lerpColor(r.ambientLight.color, from.lighting.ambient.color, to.lighting.ambient.color, t);
  r.ambientLight.intensity = _lerp(from.lighting.ambient.intensity, to.lighting.ambient.intensity, t);

  _lerpColor(r.sunLight.color, from.lighting.sun.color, to.lighting.sun.color, t);
  r.sunLight.intensity = _lerp(from.lighting.sun.intensity, to.lighting.sun.intensity, t);

  _lerpColor(r.hemiLight.color, from.lighting.hemisphere.sky, to.lighting.hemisphere.sky, t);
  _lerpColor(r.hemiLight.groundColor, from.lighting.hemisphere.ground, to.lighting.hemisphere.ground, t);
  r.hemiLight.intensity = _lerp(from.lighting.hemisphere.intensity, to.lighting.hemisphere.intensity, t);

  if (r.bloomPass) {
    r.bloomPass.strength = _lerp(from.bloom.strength, to.bloom.strength, t);
    r.bloomPass.radius = _lerp(from.bloom.radius, to.bloom.radius, t);
    r.bloomPass.threshold = _lerp(from.bloom.threshold, to.bloom.threshold, t);
  }
}

function _applyConfigToScene(config) {
  const r = _refs;

  if (!r.scene.background) r.scene.background = new THREE.Color();
  r.scene.background.set(config.background);
  r.scene.fog.color.set(config.fog.color);
  r.scene.fog.density = config.fog.density;

  r.groundMesh.material.color.set(config.ground);

  if (r.gridHelper.material.color) r.gridHelper.material.color.set(config.grid.color);
  r.gridHelper.material.opacity = config.grid.opacity;

  r.coverMat.color.set(config.cover);
  r.platformMat.color.set(config.platform);

  r.accentMat.color.set(config.accent.color);
  r.accentMat.emissive.set(config.accent.emissive);

  r.boundaryMat.color.set(config.boundary.color);
  r.boundaryMat.emissive.set(config.boundary.emissive);

  r.ambientLight.color.set(config.lighting.ambient.color);
  r.ambientLight.intensity = config.lighting.ambient.intensity;

  r.sunLight.color.set(config.lighting.sun.color);
  r.sunLight.intensity = config.lighting.sun.intensity;

  r.hemiLight.color.set(config.lighting.hemisphere.sky);
  r.hemiLight.groundColor.set(config.lighting.hemisphere.ground);
  r.hemiLight.intensity = config.lighting.hemisphere.intensity;

  if (r.bloomPass) {
    r.bloomPass.strength = config.bloom.strength;
    r.bloomPass.radius = config.bloom.radius;
    r.bloomPass.threshold = config.bloom.threshold;
  }

  if (config.hud) _applyHudColors(config.hud);
}
