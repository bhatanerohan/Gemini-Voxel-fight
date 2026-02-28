import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  initSandbox, updateEntities, updateTrails, updateSandboxTimers,
  updateParticles, fire, getShake, tickShake, setShake, switchWeapon, loadSavedWeapons,
  getActiveWeaponName, tickFrame,
} from './sandbox.js';
import { initForge, openForge, closeForge, isForgeOpen } from './forge.js';
import { initProgression, getProgress, recordGame, getCrosshairColor, getTitle } from './progression.js';
import { updateLevelDisplay } from './hud.js';
import { updateEnemyAI } from './enemyAI.js';
import { GameState } from './gameState.js';
import { initAudio, startAmbientMusic, playPlayerHit } from './audio.js';
import { initWaves, updateWaves, startNextWave } from './waves.js';
import { createDefaultStatus, clearStatus } from './statusEffects.js';
import { MatchMemory } from './matchMemory.js';
import { initArenaGod } from './arenaGod.js';
import { saveSessionSummary } from './sessionMemory.js';
import { generateChronicle, displayChronicle, hideChronicle } from './warChronicle.js';
import { initMutations, updateMutations } from './arenaMutations.js';
import { initThemeManager, applyThemeInstant, PRESETS } from './themeManager.js';
import { initThemeUI } from './themeUI.js';
import { applyAvatarConfig, updateAvatarEffects, getAvatarConcept, resetAvatar, setAvatarParticlePool } from './avatarBuilder.js';
import { initAvatarUI, showAvatarUI } from './avatarUI.js';
import { initNarrator, showNarratorLine } from './narratorUI.js';
import { getNarratorLine, preWarmNarrator } from './llama/narratorAgent.js';
import { getDamageMutation, preGenerateMutations, clearMutationCache } from './llama/damageMutationAgent.js';
import { applyDamageMutation, updateDamageEffects, checkDamageThreshold, clearDamageMutations, setDamageParticlePool } from './damageMutations.js';
import { generateArenaConfig } from './llama/arenaGenAgent.js';
import { buildArenaFromConfig, updateArenaEffects, setArenaParticlePool } from './arenaBuilder.js';
import { geminiJSON } from './geminiService.js';

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════
let renderer, labelRenderer, scene, camera, composer;
const coverBlockMeshes = [];
let _groundMesh, _gridHelper, _boundaryMat, _coverMat, _platformMat, _accentMat;
let _sunLight, _ambientLight, _hemiLight, _bloomPass;

export function getSceneRefs() {
  return {
    scene, groundMesh: _groundMesh, gridHelper: _gridHelper,
    boundaryMat: _boundaryMat, coverMat: _coverMat,
    platformMat: _platformMat, accentMat: _accentMat,
    sunLight: _sunLight, ambientLight: _ambientLight,
    hemiLight: _hemiLight, bloomPass: _bloomPass,
  };
}
let keys = {};
let mouseDown = false;
let playerYaw = 0;
let targetAimYaw = 0;
let playerAimPitch = 0;
let targetAimPitch = 0;
let aimYawDirty = true;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const aimMouseNdc = new THREE.Vector2(0, 0);
const aimRaycaster = new THREE.Raycaster();
const aimGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimHitPoint = new THREE.Vector3();
const cameraCollisionRay = new THREE.Raycaster();
const cameraCollisionMeshes = [];
const aimCollisionMeshes = [];
const cameraState = {
  initialized: false,
  position: new THREE.Vector3(),
  lookAt: new THREE.Vector3(),
};
const CAMERA_RIG = {
  pivotHeight: 1.45,
  shoulderRight: 1.15,
  shoulderUp: 0.82,
  shoulderForward: 0.2,
  distance: 6.1,
  followHeight: 0.42,
  lookHeight: 1.45,
  lookAhead: 11.5,
  positionSharpness: 9,
  lookSharpness: 11,
  collisionPadding: 0.35,
  minDistance: 2.1,
  aimDistance: 120,
};
const tempGroundHit = new THREE.Vector3();
const tempCameraForward = new THREE.Vector3();
const tempCameraRight = new THREE.Vector3();
const tempCameraPivot = new THREE.Vector3();
const tempCameraShoulder = new THREE.Vector3();
const tempCameraDesired = new THREE.Vector3();
const tempCameraLookAt = new THREE.Vector3();
const tempCameraRayDir = new THREE.Vector3();

// Slow-mo & screen flash
let slowMoTimer = 0;
let slowMoScale = 1;
let flashAlpha = 0;
let _cachedFlashEl = null;
const flashEl = () => (_cachedFlashEl || (_cachedFlashEl = document.getElementById('screen-flash')));

// Reusable Vector3s for updatePlayer (avoid per-frame allocations)
const _playerFwd = new THREE.Vector3();
const _playerRgt = new THREE.Vector3();
const _playerForce = new THREE.Vector3();

const player = { pos: new THREE.Vector3(0, 0.6, 0), vel: new THREE.Vector3(), mesh: null, hp: 100, maxHp: 100, invulnTimer: 0 };
const enemies = [];
const arenaProps = [];
const PLAYER_SKIN_STORAGE_KEY = 'voxel-arena.player-skin.v1';
const PLAYER_SKIN_PRESETS = [
  { id: 'neon-ranger', name: 'Neon Ranger', suitColor: 0x2f7dff, accentColor: 0x9fe1ff, skinColor: 0xf5d0b0, visorColor: 0x0a2038, emissive: 0x1144aa, emissiveIntensity: 0.08 },
  { id: 'ember-guard', name: 'Ember Guard', suitColor: 0xb83a2b, accentColor: 0xffa46a, skinColor: 0xf2c39f, visorColor: 0x2a1010, emissive: 0x66220f, emissiveIntensity: 0.1 },
  { id: 'jade-sentinel', name: 'Jade Sentinel', suitColor: 0x1e7f62, accentColor: 0x93ffd1, skinColor: 0xe3b58f, visorColor: 0x0d2420, emissive: 0x0e4737, emissiveIntensity: 0.09 },
  { id: 'void-striker', name: 'Void Striker', suitColor: 0x3a2d7a, accentColor: 0xd0b6ff, skinColor: 0xd8ae93, visorColor: 0x130d2a, emissive: 0x2b1d5a, emissiveIntensity: 0.1 },
];
const AVATAR_SKIN_SYSTEM_PROMPT = `You design one voxel-combat avatar skin palette from a short user prompt.

Return ONLY JSON with this exact schema:
{
  "name": "short skin name",
  "suitColor": "#RRGGBB",
  "accentColor": "#RRGGBB",
  "skinColor": "#RRGGBB",
  "visorColor": "#RRGGBB",
  "emissive": "#RRGGBB",
  "emissiveIntensity": 0.00
}

Rules:
- Colors must be valid 6-digit hex strings.
- emissiveIntensity must be between 0.02 and 0.18.
- Keep high contrast between suit and accent.
- Keep skinColor natural-looking for a humanoid face.
- Be faithful to the user prompt theme and vibe.
- No markdown, no code fences, no explanation, JSON only.`;

const DEFAULT_PLAYER_SKIN_PRESET_ID = 'neon-ranger';
let playerSkinState = null;
let _skinPresetSelect = null;
let _skinSuitInput = null;
let _skinAccentInput = null;
let _skinToneInput = null;
let _skinVisorInput = null;
let _skinPromptInput = null;
let _skinApplyButton = null;
let _skinNameLabel = null;
let _skinPromptAbortController = null;

function getSkinPresetById(id) {
  return PLAYER_SKIN_PRESETS.find(p => p.id === id) || PLAYER_SKIN_PRESETS[0];
}

function clampHexColor(value, fallback = 0xffffff) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(0xffffff, Math.floor(value)));
}

function toInputHex(value) {
  return `#${clampHexColor(value).toString(16).padStart(6, '0')}`;
}

function fromInputHex(value, fallback = 0xffffff) {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value.replace('#', '').replace(/^0x/i, ''), 16);
  return clampHexColor(parsed, fallback);
}

function parseColorValue(value, fallback = 0xffffff) {
  if (typeof value === 'number') return clampHexColor(value, fallback);
  if (typeof value === 'string') return fromInputHex(value, fallback);
  return fallback;
}

function sanitizePromptText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 80);
}

function hashString32(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildGeneratedPromptSkin(promptText) {
  const lower = promptText.toLowerCase();
  const seed = hashString32(lower);
  const hueBase = (seed % 360) / 360;
  const suitLight = 0.2 + ((seed >>> 10) % 16) / 100;
  const suit = new THREE.Color().setHSL(hueBase, 0.62, suitLight);
  const accent = new THREE.Color().setHSL((hueBase + 0.12) % 1, 0.72, Math.min(0.72, suitLight + 0.26));
  const visor = new THREE.Color().setHSL(hueBase, 0.3, Math.max(0.07, suitLight - 0.12));
  const emissive = new THREE.Color().setHSL((hueBase + 0.04) % 1, 0.75, 0.15);
  const skinPalette = [0xf7d7c3, 0xefc5a3, 0xd9ae87, 0xbe8f67, 0x8c6647];
  const skin = skinPalette[(seed >>> 4) % skinPalette.length];
  return {
    presetId: 'custom',
    presetName: `Prompt: ${promptText}`,
    promptText,
    suitColor: suit.getHex(),
    accentColor: accent.getHex(),
    skinColor: skin,
    visorColor: visor.getHex(),
    emissive: emissive.getHex(),
    emissiveIntensity: 0.09,
  };
}

function buildSkinFromGeminiResponse(response, promptText) {
  const basePreset = getSkinPresetById(DEFAULT_PLAYER_SKIN_PRESET_ID);
  const aiName = typeof response?.name === 'string' && response.name.trim() ? response.name.trim().slice(0, 30) : promptText;
  return {
    presetId: 'custom',
    presetName: `AI: ${aiName}`,
    promptText,
    suitColor: parseColorValue(response?.suitColor, basePreset.suitColor),
    accentColor: parseColorValue(response?.accentColor, basePreset.accentColor),
    skinColor: parseColorValue(response?.skinColor, basePreset.skinColor),
    visorColor: parseColorValue(response?.visorColor, basePreset.visorColor),
    emissive: parseColorValue(response?.emissive, basePreset.emissive),
    emissiveIntensity: Number.isFinite(response?.emissiveIntensity)
      ? THREE.MathUtils.clamp(response.emissiveIntensity, 0, 1)
      : basePreset.emissiveIntensity,
  };
}

async function generateSkinFromPrompt(rawPrompt, signal) {
  const promptText = sanitizePromptText(rawPrompt);
  if (!promptText) return null;

  const aiResponse = await geminiJSON({
    systemPrompt: AVATAR_SKIN_SYSTEM_PROMPT,
    userMessage: `Create a skin for this avatar prompt: "${promptText}"`,
    temperature: 0.65,
    maxTokens: 4096,
    signal,
  });

  if (aiResponse) {
    return buildSkinFromGeminiResponse(aiResponse, promptText);
  }

  return buildGeneratedPromptSkin(promptText);
}

function buildPlayerSkinConfig(config = {}) {
  const preset = getSkinPresetById(config.presetId || DEFAULT_PLAYER_SKIN_PRESET_ID);
  return {
    presetId: typeof config.presetId === 'string' ? config.presetId : preset.id,
    presetName: typeof config.presetName === 'string' ? config.presetName : preset.name,
    promptText: sanitizePromptText(config.promptText),
    suitColor: parseColorValue(config.suitColor ?? preset.suitColor, preset.suitColor),
    accentColor: parseColorValue(config.accentColor ?? preset.accentColor, preset.accentColor),
    skinColor: parseColorValue(config.skinColor ?? preset.skinColor, preset.skinColor),
    visorColor: parseColorValue(config.visorColor ?? preset.visorColor, preset.visorColor),
    emissive: parseColorValue(config.emissive ?? preset.emissive, preset.emissive),
    emissiveIntensity: Number.isFinite(config.emissiveIntensity) ? THREE.MathUtils.clamp(config.emissiveIntensity, 0, 1) : preset.emissiveIntensity,
  };
}

function loadPlayerSkinConfig() {
  try {
    const raw = localStorage.getItem(PLAYER_SKIN_STORAGE_KEY);
    if (!raw) return buildPlayerSkinConfig();
    const parsed = JSON.parse(raw);
    return buildPlayerSkinConfig(parsed);
  } catch (err) {
    console.warn('Failed to load player skin config:', err);
    return buildPlayerSkinConfig();
  }
}

function savePlayerSkinConfig() {
  try {
    localStorage.setItem(PLAYER_SKIN_STORAGE_KEY, JSON.stringify(playerSkinState));
  } catch (err) {
    console.warn('Failed to save player skin config:', err);
  }
}

playerSkinState = loadPlayerSkinConfig();

function applySkinToPlayerMesh() {
  const rig = player.mesh?.userData?.rig;
  const materials = rig?.materials;
  if (!materials || !playerSkinState) return;
  materials.suit.color.setHex(playerSkinState.suitColor);
  materials.suit.emissive.setHex(playerSkinState.emissive);
  materials.suit.emissiveIntensity = playerSkinState.emissiveIntensity;
  materials.accent.color.setHex(playerSkinState.accentColor);
  materials.accent.emissive.setHex(playerSkinState.emissive);
  materials.accent.emissiveIntensity = playerSkinState.emissiveIntensity * 0.5;
  materials.skin.color.setHex(playerSkinState.skinColor);
  materials.visor.color.setHex(playerSkinState.visorColor);
}

function syncSkinUi() {
  if (_skinPresetSelect) {
    const hasPreset = PLAYER_SKIN_PRESETS.some(p => p.id === playerSkinState.presetId);
    _skinPresetSelect.value = hasPreset ? playerSkinState.presetId : 'custom';
  }
  if (_skinSuitInput) _skinSuitInput.value = toInputHex(playerSkinState.suitColor);
  if (_skinAccentInput) _skinAccentInput.value = toInputHex(playerSkinState.accentColor);
  if (_skinToneInput) _skinToneInput.value = toInputHex(playerSkinState.skinColor);
  if (_skinVisorInput) _skinVisorInput.value = toInputHex(playerSkinState.visorColor);
  if (_skinPromptInput) _skinPromptInput.value = playerSkinState.promptText || '';
  if (_skinNameLabel) _skinNameLabel.textContent = `Current: ${playerSkinState.presetName}`;
}

function setPlayerSkin(config, { syncUi = true } = {}) {
  playerSkinState = buildPlayerSkinConfig(config);
  applySkinToPlayerMesh();
  savePlayerSkinConfig();
  if (syncUi) syncSkinUi();
}

function cyclePlayerSkinPreset() {
  const index = PLAYER_SKIN_PRESETS.findIndex(p => p.id === playerSkinState.presetId);
  const next = PLAYER_SKIN_PRESETS[(index + 1 + PLAYER_SKIN_PRESETS.length) % PLAYER_SKIN_PRESETS.length];
  setPlayerSkin(next);
}

function randomPlayerColor() {
  return Math.floor(Math.random() * 0xffffff);
}

function setSkinPromptPending(isPending) {
  if (_skinApplyButton) {
    _skinApplyButton.disabled = isPending;
    _skinApplyButton.textContent = isPending ? 'Generating...' : 'Apply';
  }
}

function initSkinUi() {
  _skinPresetSelect = document.getElementById('player-skin-preset');
  _skinSuitInput = document.getElementById('player-skin-suit');
  _skinAccentInput = document.getElementById('player-skin-accent');
  _skinToneInput = document.getElementById('player-skin-tone');
  _skinVisorInput = document.getElementById('player-skin-visor');
  _skinPromptInput = document.getElementById('player-skin-prompt');
  _skinNameLabel = document.getElementById('player-skin-name');
  _skinApplyButton = document.getElementById('player-skin-apply');
  const randomButton = document.getElementById('player-skin-random');

  if (!_skinPresetSelect || !_skinSuitInput || !_skinAccentInput || !_skinToneInput || !_skinVisorInput) return;

  _skinPresetSelect.innerHTML = '';
  for (const preset of PLAYER_SKIN_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    _skinPresetSelect.appendChild(option);
  }
  const customOption = document.createElement('option');
  customOption.value = 'custom';
  customOption.textContent = 'Custom';
  _skinPresetSelect.appendChild(customOption);

  _skinPresetSelect.addEventListener('change', () => {
    if (_skinPresetSelect.value === 'custom') {
      setPlayerSkin({ ...playerSkinState, presetId: 'custom', presetName: 'Custom', promptText: '' });
      return;
    }
    const preset = getSkinPresetById(_skinPresetSelect.value);
    setPlayerSkin({ ...preset, promptText: '' });
  });

  const onColorEdit = () => {
    setPlayerSkin({
      ...playerSkinState,
      presetId: 'custom',
      presetName: 'Custom',
      promptText: '',
      suitColor: fromInputHex(_skinSuitInput.value, playerSkinState.suitColor),
      accentColor: fromInputHex(_skinAccentInput.value, playerSkinState.accentColor),
      skinColor: fromInputHex(_skinToneInput.value, playerSkinState.skinColor),
      visorColor: fromInputHex(_skinVisorInput.value, playerSkinState.visorColor),
    });
  };
  _skinSuitInput.addEventListener('input', onColorEdit);
  _skinAccentInput.addEventListener('input', onColorEdit);
  _skinToneInput.addEventListener('input', onColorEdit);
  _skinVisorInput.addEventListener('input', onColorEdit);

  const applyPromptSkin = async () => {
    const promptText = sanitizePromptText(_skinPromptInput?.value);
    if (!promptText) return;

    if (_skinPromptAbortController) _skinPromptAbortController.abort();
    const ctrl = new AbortController();
    _skinPromptAbortController = ctrl;
    setSkinPromptPending(true);
    if (_skinNameLabel) _skinNameLabel.textContent = 'Current: Generating AI skin...';

    try {
      const skinConfig = await generateSkinFromPrompt(promptText, ctrl.signal);
      if (ctrl.signal.aborted || !skinConfig) return;
      setPlayerSkin(skinConfig);
    } catch (err) {
      if (!ctrl.signal.aborted) {
        console.warn('Skin generation failed:', err);
      }
    } finally {
      if (_skinPromptAbortController === ctrl) {
        _skinPromptAbortController = null;
        setSkinPromptPending(false);
        syncSkinUi();
      }
    }
  };
  _skinApplyButton?.addEventListener('click', applyPromptSkin);
  _skinPromptInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyPromptSkin();
    }
  });

  randomButton?.addEventListener('click', () => {
    setPlayerSkin({
      ...playerSkinState,
      presetId: 'custom',
      presetName: 'Custom',
      promptText: '',
      suitColor: randomPlayerColor(),
      accentColor: randomPlayerColor(),
      skinColor: randomPlayerColor(),
      visorColor: randomPlayerColor(),
      emissive: randomPlayerColor(),
    });
  });

  setSkinPromptPending(false);
  syncSkinUi();
}

// ── Destructible Crates ──
function registerArenaProp(prop, collisionMeshes = []) {
  scene.add(prop.mesh);
  for (const mesh of collisionMeshes) {
    if (!mesh) continue;
    cameraCollisionMeshes.push(mesh);
    aimCollisionMeshes.push(mesh);
  }
  arenaProps.push(prop);
  return prop;
}

function createCrate({ stacked = false } = {}) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8B6914, roughness: 0.65, metalness: 0.1, flatShading: true,
    emissive: 0x000000, emissiveIntensity: 0,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0x6B4F10, roughness: 0.7, metalness: 0.05, flatShading: true,
  });
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.15, 1.25), bandMat);
  band.position.y = 0.2;
  band.castShadow = true;
  group.add(band);
  const band2 = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.15, 1.25), bandMat);
  band2.position.y = -0.2;
  band2.castShadow = true;
  group.add(band2);

  const reactiveMeshes = [mesh, band, band2];
  if (stacked) {
    const upperMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), mat.clone());
    upperMesh.position.set(0, 0.98, 0);
    upperMesh.castShadow = true;
    upperMesh.receiveShadow = true;
    group.add(upperMesh);

    const upperBand = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.12, 0.98), bandMat.clone());
    upperBand.position.set(0, 1.1, 0);
    upperBand.castShadow = true;
    group.add(upperBand);
    reactiveMeshes.push(upperMesh, upperBand);
  }

  return { group, bodyMesh: mesh, reactiveMeshes };
}

function createReactiveWallSegment({ width = 3.6, height = 2.2, depth = 1.05 } = {}) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x2e3550,
    roughness: 0.56,
    metalness: 0.28,
    flatShading: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x607cb6,
    roughness: 0.34,
    metalness: 0.58,
    flatShading: true,
    emissive: 0x081224,
    emissiveIntensity: 0.2,
  });
  const braceMat = new THREE.MeshStandardMaterial({
    color: 0x3a4668,
    roughness: 0.42,
    metalness: 0.35,
    flatShading: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });

  const addSegment = (geo, material, x, y, z) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  const bodyMesh = addSegment(new THREE.BoxGeometry(width, height, depth), wallMat, 0, 0, 0);
  const cap = addSegment(new THREE.BoxGeometry(width + 0.22, 0.18, depth + 0.14), trimMat, 0, height * 0.5 + 0.12, 0);
  const panel = addSegment(new THREE.BoxGeometry(width * 0.62, height * 0.36, depth + 0.08), trimMat, 0, 0.08, 0);
  const leftPost = addSegment(new THREE.BoxGeometry(0.28, height + 0.18, depth + 0.16), braceMat, -width * 0.5 + 0.12, 0, 0);
  const rightPost = addSegment(new THREE.BoxGeometry(0.28, height + 0.18, depth + 0.16), braceMat, width * 0.5 - 0.12, 0, 0);
  return { group, bodyMesh, reactiveMeshes: [bodyMesh, cap, panel, leftPost, rightPost] };
}

function addArenaCrate(x, z, opts = {}) {
  const { hp = 50, stacked = false } = opts;
  const { group, bodyMesh, reactiveMeshes } = createCrate({ stacked });
  group.position.set(x, 0.6, z);
  registerArenaProp({
    kind: 'crate',
    pos: new THREE.Vector3(x, 0.6, z),
    vel: new THREE.Vector3(),
    hp,
    maxHp: hp,
    alive: true,
    mesh: group,
    bodyMesh,
    reactiveMeshes,
    fadeMeshes: reactiveMeshes,
    isObject: true,
    movable: true,
    forceResponse: 0.42,
    returnStrength: 2.8,
    fragmentColor: 0x8B6914,
    particleColor: 0xbb8822,
    respawnDelayMs: 12000,
    originalPos: new THREE.Vector3(x, 0.6, z),
    status: createDefaultStatus(),
  }, [bodyMesh]);
}

function addArenaWall(x, z, rotationY = 0, opts = {}) {
  const { width = 3.6, height = 2.2, depth = 1.05, hp = 80 } = opts;
  const { group, bodyMesh, reactiveMeshes } = createReactiveWallSegment({ width, height, depth });
  group.position.set(x, height * 0.5, z);
  group.rotation.y = rotationY;
  registerArenaProp({
    kind: 'wall',
    pos: new THREE.Vector3(x, height * 0.5, z),
    vel: new THREE.Vector3(),
    hp,
    maxHp: hp,
    alive: true,
    mesh: group,
    bodyMesh,
    reactiveMeshes,
    fadeMeshes: reactiveMeshes,
    isObject: true,
    movable: false,
    fragmentColor: 0x4c5d88,
    particleColor: 0x85a2ff,
    respawnDelayMs: 16000,
    originalPos: new THREE.Vector3(x, height * 0.5, z),
    status: createDefaultStatus(),
  }, [bodyMesh]);
}

function initArenaProps() {
  const centralWallSegments = [
    [-14, -11, 0], [-5, -11, 0], [5, -11, 0], [14, -11, 0],
    [-14, 11, 0], [-5, 11, 0], [5, 11, 0], [14, 11, 0],
    [-11, -14, Math.PI / 2], [-11, -5, Math.PI / 2], [-11, 5, Math.PI / 2], [-11, 14, Math.PI / 2],
    [11, -14, Math.PI / 2], [11, -5, Math.PI / 2], [11, 5, Math.PI / 2], [11, 14, Math.PI / 2],
  ];
  centralWallSegments.forEach(([x, z, rot]) => {
    addArenaWall(x, z, rot, { width: 4.8, height: 2.2, depth: 1.05, hp: 82 });
  });

  const bunkerCorners = [
    [-31, -29, 0], [-27.6, -25.6, Math.PI / 2],
    [31, -29, 0], [27.6, -25.6, Math.PI / 2],
    [-31, 29, 0], [-27.6, 25.6, Math.PI / 2],
    [31, 29, 0], [27.6, 25.6, Math.PI / 2],
  ];
  bunkerCorners.forEach(([x, z, rot]) => {
    addArenaWall(x, z, rot, { width: 4.1, height: 2.5, depth: 1.1, hp: 96 });
  });

  [
    [-6, -6, true], [6, -6, false], [-6, 6, false], [6, 6, true],
    [0, -18, false], [0, 18, false], [-18, 0, false], [18, 0, false],
    [-24, -12, true], [24, -12, true], [-24, 12, true], [24, 12, true],
  ].forEach(([x, z, stacked]) => addArenaCrate(x, z, { stacked }));
}

function createVoxelHumanoid({
  suitColor = 0x3a7cff,
  accentColor = 0x88d6ff,
  skinColor = 0xf3c7a2,
  emissive = 0x000000,
  emissiveIntensity = 0,
  visorColor = 0x112233,
  showMuzzleGauntlet = false,
} = {}) {
  const group = new THREE.Group();
  const rigRoot = new THREE.Group();
  group.add(rigRoot);

  const suitMat = new THREE.MeshStandardMaterial({
    color: suitColor,
    emissive,
    emissiveIntensity,
    roughness: 0.48,
    metalness: 0.12,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive,
    emissiveIntensity: emissiveIntensity * 0.5,
    roughness: 0.4,
    metalness: 0.08,
    flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.7,
    metalness: 0.02,
    flatShading: true,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: visorColor,
    emissive: 0x111a22,
    emissiveIntensity: 0.16,
    roughness: 0.2,
    metalness: 0.55,
    flatShading: true,
  });

  const addPart = (parent, geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const armSize = { x: 0.2, y: 0.62, z: 0.22 };
  const legSize = { x: 0.26, y: 0.62, z: 0.26 };

  const bodyMesh = addPart(rigRoot, new THREE.BoxGeometry(0.64, 0.72, 0.34), suitMat, 0, 0.4, 0);
  addPart(rigRoot, new THREE.BoxGeometry(0.42, 0.26, 0.36), accentMat, 0, 0.5, -0.02);
  addPart(rigRoot, new THREE.BoxGeometry(0.32, 0.36, 0.16), accentMat, 0, 0.42, 0.25);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.79, 0);
  rigRoot.add(headPivot);
  const head = addPart(headPivot, new THREE.BoxGeometry(0.48, 0.48, 0.48), skinMat, 0, 0.24, 0);
  addPart(headPivot, new THREE.BoxGeometry(0.52, 0.12, 0.52), accentMat, 0, 0.53, 0);
  const visor = addPart(headPivot, new THREE.BoxGeometry(0.28, 0.12, 0.08), visorMat, 0, 0.27, -0.25);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.44, 0.68, 0);
  rigRoot.add(leftArmPivot);
  addPart(leftArmPivot, new THREE.BoxGeometry(armSize.x, armSize.y, armSize.z), suitMat, 0, -armSize.y * 0.5, 0);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.44, 0.68, 0);
  rigRoot.add(rightArmPivot);
  addPart(rightArmPivot, new THREE.BoxGeometry(armSize.x, armSize.y, armSize.z), suitMat, 0, -armSize.y * 0.5, 0);

  let muzzleTip = null;
  if (showMuzzleGauntlet) {
    const gauntletRoot = new THREE.Group();
    gauntletRoot.position.set(0.04, -armSize.y + 0.05, -0.04);
    rightArmPivot.add(gauntletRoot);

    addPart(gauntletRoot, new THREE.BoxGeometry(0.42, 0.5, 0.56), suitMat, 0, -0.02, 0.04);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.28, 0.16, 0.36), accentMat, 0, 0.12, 0.07);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.14, 0.4, 0.22), accentMat, -0.2, -0.02, -0.02);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.14, 0.4, 0.22), accentMat, 0.2, -0.02, -0.02);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.18, 0.1, 0.38), accentMat, 0, -0.2, 0.04);

    const barrelSegments = [
      { radius: 0.23, length: 0.14, z: -0.1 },
      { radius: 0.205, length: 0.13, z: -0.22 },
      { radius: 0.18, length: 0.12, z: -0.33 },
      { radius: 0.155, length: 0.11, z: -0.43 },
    ];
    for (const segment of barrelSegments) {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(segment.radius * 0.92, segment.radius, segment.length, 12, 1, false),
        suitMat,
      );
      shell.rotation.x = Math.PI / 2;
      shell.position.set(0, -0.02, segment.z);
      shell.castShadow = true;
      shell.receiveShadow = true;
      gauntletRoot.add(shell);
    }

    const barrelCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.094, 0.54, 12),
      visorMat,
    );
    barrelCore.rotation.x = Math.PI / 2;
    barrelCore.position.set(0, -0.02, -0.28);
    barrelCore.castShadow = true;
    barrelCore.receiveShadow = true;
    gauntletRoot.add(barrelCore);

    const muzzleRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.175, 0.08, 12, 1, true),
      accentMat,
    );
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0, -0.02, -0.5);
    muzzleRing.castShadow = true;
    muzzleRing.receiveShadow = true;
    gauntletRoot.add(muzzleRing);

    const muzzleCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.045, 12),
      visorMat,
    );
    muzzleCap.rotation.x = Math.PI / 2;
    muzzleCap.position.set(0, -0.02, -0.54);
    muzzleCap.castShadow = true;
    muzzleCap.receiveShadow = true;
    gauntletRoot.add(muzzleCap);

    muzzleTip = new THREE.Group();
    muzzleTip.position.set(0, -0.02, -0.57);
    gauntletRoot.add(muzzleTip);
  }

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.16, 0.02, 0);
  rigRoot.add(leftLegPivot);
  addPart(leftLegPivot, new THREE.BoxGeometry(legSize.x, legSize.y, legSize.z), suitMat, 0, -legSize.y * 0.5, 0);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.16, 0.02, 0);
  rigRoot.add(rightLegPivot);
  addPart(rightLegPivot, new THREE.BoxGeometry(legSize.x, legSize.y, legSize.z), suitMat, 0, -legSize.y * 0.5, 0);

  const rig = {
    root: rigRoot,
    body: bodyMesh,
    headPivot,
    head,
    visor,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    hasMuzzleGauntlet: showMuzzleGauntlet,
    muzzleTip,
    phase: Math.random() * Math.PI * 2,
    speed: 0,
    swing: 0,
    bob: 0,
    materials: {
      suit: suitMat,
      accent: accentMat,
      skin: skinMat,
      visor: visorMat,
    },
  };

  group.userData.rig = rig;
  return { group, bodyMesh, rig };
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function dampFactor(sharpness, dt) {
  return 1 - Math.exp(-sharpness * dt);
}

let _cachedCrosshairEl = null;
function setCrosshairPosition(clientX, clientY) {
  const crosshair = _cachedCrosshairEl || (_cachedCrosshairEl = document.getElementById('crosshair'));
  if (!crosshair) return;
  crosshair.style.left = `${clientX}px`;
  crosshair.style.top = `${clientY}px`;
}

function syncCrosshairToAim() {
  const clientX = (aimMouseNdc.x * 0.5 + 0.5) * innerWidth;
  const clientY = (-aimMouseNdc.y * 0.5 + 0.5) * innerHeight;
  setCrosshairPosition(clientX, clientY);
}

const _shootOrigin = new THREE.Vector3();
function getPlayerShootOrigin() {
  const muzzleTip = player.mesh?.userData?.rig?.muzzleTip;
  if (muzzleTip && typeof muzzleTip.getWorldPosition === 'function') {
    return muzzleTip.getWorldPosition(_shootOrigin);
  }
  _shootOrigin.copy(player.pos);
  _shootOrigin.y += 0.95;
  return _shootOrigin;
}

function getPlayerAimPoint() {
  const aimPoint = resolveAimPoint();
  return aimPoint ? aimPoint.clone() : null;
}

function updateAimFromMouseEvent(e) {
  aimMouseNdc.x = (e.clientX / innerWidth) * 2 - 1;
  aimMouseNdc.y = -(e.clientY / innerHeight) * 2 + 1;
  setCrosshairPosition(e.clientX, e.clientY);
  aimYawDirty = true;
}

function resolveAimPoint() {
  if (!camera) return null;

  aimRaycaster.setFromCamera(aimMouseNdc, camera);
  aimRaycaster.far = CAMERA_RIG.aimDistance;

  if (aimCollisionMeshes.length > 0) {
    const hits = aimRaycaster.intersectObjects(aimCollisionMeshes, false);
    if (hits.length > 0) {
      aimHitPoint.copy(hits[0].point);
      return aimHitPoint;
    }
  }

  if (aimRaycaster.ray.intersectPlane(aimGroundPlane, tempGroundHit)) {
    aimHitPoint.copy(tempGroundHit);
    return aimHitPoint;
  }

  aimHitPoint.copy(aimRaycaster.ray.origin).addScaledVector(aimRaycaster.ray.direction, CAMERA_RIG.aimDistance);
  return aimHitPoint;
}

function updateAimLocomotion(dt) {
  if (aimYawDirty) {
    const aimPoint = getPlayerAimPoint();
    if (aimPoint) {
      const dx = aimPoint.x - player.pos.x;
      const dz = aimPoint.z - player.pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= 0.04) {
        targetAimYaw = Math.atan2(-dx, -dz);
        const shootOrigin = getPlayerShootOrigin();
        const aimFromMuzzle = aimPoint.clone().sub(shootOrigin);
        const aimHorizontal = Math.hypot(aimFromMuzzle.x, aimFromMuzzle.z);
        if (aimHorizontal > 0.001 || Math.abs(aimFromMuzzle.y) > 0.001) {
          targetAimPitch = THREE.MathUtils.clamp(
            Math.atan2(aimFromMuzzle.y, Math.max(0.001, aimHorizontal)),
            -0.85,
            0.85,
          );
        }
        aimYawDirty = false;
      }
    }
  }

  playerYaw += angleDelta(playerYaw, targetAimYaw) * dampFactor(18, dt);
  playerAimPitch += (targetAimPitch - playerAimPitch) * dampFactor(18, dt);
}

function animateHumanoid(mesh, dt, horizontalSpeed = 0, { frozen = false, localForward = 0, localRight = 0 } = {}) {
  const rig = mesh?.userData?.rig;
  if (!rig) return;

  const speedNorm = frozen ? 0 : THREE.MathUtils.clamp(horizontalSpeed / 16, 0, 1.4);
  const blendIn = Math.min(1, dt * 10);
  rig.speed = THREE.MathUtils.lerp(rig.speed, speedNorm, blendIn);

  rig.phase += dt * THREE.MathUtils.lerp(3.5, 11, Math.min(1, rig.speed));

  const moving = rig.speed > 0.05;
  const localMoveMag = Math.abs(localForward) + Math.abs(localRight);
  const forwardMix = localMoveMag > 0.001 ? Math.abs(localForward) / localMoveMag : 1;
  const strafeMix = localMoveMag > 0.001 ? Math.abs(localRight) / localMoveMag : 0;
  const strideSign = localForward < -0.05 ? -1 : 1;
  const strafeSign = Math.sign(localRight);
  const stride = moving ? THREE.MathUtils.lerp(0.12, 0.8, Math.min(1, rig.speed)) : 0;
  const targetSwing = Math.sin(rig.phase) * stride * strideSign;
  const targetBob = moving ? Math.max(0, Math.sin(rig.phase * 2)) * 0.065 * rig.speed : 0;
  const lean = moving ? -strafeSign * 0.12 * strafeMix : 0;
  const legSpread = moving ? 0.1 * strafeMix : 0;

  rig.swing = THREE.MathUtils.lerp(rig.swing, targetSwing, Math.min(1, dt * 12));
  rig.bob = THREE.MathUtils.lerp(rig.bob, targetBob, Math.min(1, dt * 12));

  rig.leftArmPivot.rotation.x = rig.swing * 0.9;
  if (rig.hasMuzzleGauntlet) {
    const rightArmBaseX = 1.34;
    const rightArmSwing = moving ? -rig.swing * 0.18 * (0.45 + 0.55 * forwardMix) : 0;
    rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.x,
      rightArmBaseX + playerAimPitch + rightArmSwing,
      Math.min(1, dt * 12),
    );
    rig.rightArmPivot.rotation.y = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.y,
      -0.06,
      Math.min(1, dt * 10),
    );
    rig.rightArmPivot.rotation.z = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.z,
      -0.18 - 0.025 * strafeSign * strafeMix,
      Math.min(1, dt * 10),
    );
  } else {
    rig.rightArmPivot.rotation.x = -rig.swing * 0.9;
    rig.rightArmPivot.rotation.y = THREE.MathUtils.lerp(rig.rightArmPivot.rotation.y, 0, Math.min(1, dt * 10));
    rig.rightArmPivot.rotation.z = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.z,
      -0.08 * strafeSign * strafeMix,
      Math.min(1, dt * 10),
    );
  }
  rig.leftArmPivot.rotation.z = THREE.MathUtils.lerp(rig.leftArmPivot.rotation.z, -0.08 * strafeSign * strafeMix, Math.min(1, dt * 10));
  rig.leftLegPivot.rotation.x = -rig.swing * 1.1;
  rig.rightLegPivot.rotation.x = rig.swing * 1.1;
  rig.leftLegPivot.rotation.z = THREE.MathUtils.lerp(rig.leftLegPivot.rotation.z, legSpread, Math.min(1, dt * 10));
  rig.rightLegPivot.rotation.z = THREE.MathUtils.lerp(rig.rightLegPivot.rotation.z, -legSpread, Math.min(1, dt * 10));

  const torsoTwist = moving ? Math.sin(rig.phase) * 0.08 * rig.speed * (0.5 + 0.5 * forwardMix) : 0;
  rig.body.rotation.y = torsoTwist;
  rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, lean, Math.min(1, dt * 10));
  rig.headPivot.rotation.y = -torsoTwist * 0.55;
  rig.headPivot.rotation.x = moving ? Math.sin(rig.phase * 2) * 0.03 * rig.speed : 0;
  rig.root.position.y = rig.bob * 0.5;
  rig.head.position.y = 0.24 + rig.bob * 0.25;
  rig.visor.position.y = 0.27 + rig.bob * 0.12;
}

// Expose slow-mo and flash for sandbox
export function triggerSlowMo(duration = 0.4, scale = 0.15) {
  slowMoTimer = duration;
  slowMoScale = scale;
}
export function triggerFlash(alpha = 0.3) {
  flashAlpha = alpha;
}

// ══════════════════════════════════════════════════
// PROGRESSION
// ══════════════════════════════════════════════════
function refreshLevelHUD() {
  const p = getProgress();
  updateLevelDisplay(p.level, p.xp, p.xpToNext, getTitle());
}

function applyCrosshairReward() {
  const color = getCrosshairColor();
  const crosshair = document.getElementById('crosshair');
  if (crosshair) crosshair.style.setProperty('--crosshair-color', color);
}

export function onGameOver() {
  recordGame(GameState.score, GameState.kills, GameState.wave);
  refreshLevelHUD();
  applyCrosshairReward();
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  document.body.appendChild(renderer.domElement);

  initAudio();
  document.addEventListener('click', () => startAmbientMusic(), { once: true });

  // CSS2D Renderer for health bars
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(labelRenderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060612);
  scene.fog = new THREE.FogExp2(0x060612, 0.011);

  // Camera
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

  // Bloom - reduced intensity for softer glow
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    _bloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.3, 0.3
    );
    composer.addPass(_bloomPass);
  } catch (e) {
    console.warn('Bloom not available:', e);
    composer = null;
  }

  // Lights
  _ambientLight = new THREE.AmbientLight(0x223344, 0.6);
  scene.add(_ambientLight);
  _sunLight = new THREE.DirectionalLight(0xffeedd, 1.0);
  _sunLight.position.set(30, 50, 20);
  _sunLight.castShadow = true;
  _sunLight.shadow.mapSize.set(2048, 2048);
  const sc = _sunLight.shadow.camera;
  sc.left = sc.bottom = -60;
  sc.right = sc.top = 60;
  scene.add(_sunLight);
  _hemiLight = new THREE.HemisphereLight(0x4488ff, 0x221111, 0.3);
  scene.add(_hemiLight);

  // Ground
  _groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x0e0e1a, roughness: 0.9, metalness: 0.1 })
  );
  _groundMesh.rotation.x = -Math.PI / 2;
  _groundMesh.receiveShadow = true;
  scene.add(_groundMesh);

  // Grid
  _gridHelper = new THREE.GridHelper(200, 100, 0x1a1a44, 0x111128);
  _gridHelper.position.y = 0.02;
  _gridHelper.material.opacity = 0.35;
  _gridHelper.material.transparent = true;
  scene.add(_gridHelper);

  // Arena boundary — glowing neon strips
  _boundaryMat = new THREE.MeshStandardMaterial({
    color: 0x0088ff, emissive: 0x003388, emissiveIntensity: 0.7,
    roughness: 0.2, metalness: 0.8,
  });
  [[0, 0.15, -50.2, 100, 0.3, 0.4], [0, 0.15, 50.2, 100, 0.3, 0.4],
   [-50.2, 0.15, 0, 0.4, 0.3, 100], [50.2, 0.15, 0, 0.4, 0.3, 100]].forEach(([x,y,z,sx,sy,sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), _boundaryMat);
    m.position.set(x, y, z);
    scene.add(m);
  });

  // Walls (invisible collision — visual is the glow strip)
  const wm = new THREE.MeshStandardMaterial({ color: 0x151530, roughness: 0.7, transparent: true, opacity: 0.4 });
  [[0, -50, 100, 4, 1], [0, 50, 100, 4, 1], [-50, 0, 1, 4, 100], [50, 0, 1, 4, 100]].forEach(([x, z, sx, sy, sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wm);
    m.position.set(x, sy / 2, z);
    scene.add(m);
    cameraCollisionMeshes.push(m);
    aimCollisionMeshes.push(m);
  });

  // ── Arena Obstacles ──
  _coverMat = new THREE.MeshStandardMaterial({ color: 0x252540, roughness: 0.6, metalness: 0.3 });
  _platformMat = new THREE.MeshStandardMaterial({ color: 0x2a2a50, roughness: 0.5, metalness: 0.4 });
  _accentMat = new THREE.MeshStandardMaterial({
    color: 0x003366, emissive: 0x001133, emissiveIntensity: 0.3, roughness: 0.3, metalness: 0.6
  });

  // Cover blocks — symmetrical layout for fair gameplay
  const coverBlocks = [
    [12, 12, 2, 2.5, 2], [-12, 12, 2, 2.5, 2], [12, -12, 2, 2.5, 2], [-12, -12, 2, 2.5, 2],
    [0, 22, 6, 1.8, 1.2], [0, -22, 6, 1.8, 1.2], [22, 0, 1.2, 1.8, 6], [-22, 0, 1.2, 1.8, 6],
    [30, 18, 3, 1.5, 3], [-30, 18, 3, 1.5, 3], [30, -18, 3, 1.5, 3], [-30, -18, 3, 1.5, 3],
    [-8, -30, 2, 1, 4], [8, 30, 2, 1, 4],
  ];

  coverBlocks.forEach(([x, z, sx, sy, sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), _coverMat);
    m.position.set(x, sy / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    cameraCollisionMeshes.push(m);
    aimCollisionMeshes.push(m);
    coverBlockMeshes.push(m);
  });

  // Elevated platforms
  [
    { x: -35, z: -35, w: 8, h: 1.5, d: 8 },
    { x: 35, z: 35, w: 8, h: 1.5, d: 8 },
  ].forEach(({ x, z, w, h, d }) => {
    const plat = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _platformMat);
    plat.position.set(x, h / 2, z);
    plat.castShadow = true;
    plat.receiveShadow = true;
    scene.add(plat);
    cameraCollisionMeshes.push(plat);
    aimCollisionMeshes.push(plat);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.1, d + 0.2), _accentMat);
    strip.position.set(x, h + 0.05, z);
    scene.add(strip);
  });

  // ── Theme system ──
  initThemeManager(getSceneRefs());
  applyThemeInstant(PRESETS.neon);
  initThemeUI();

  // Player - voxel human
  player.mesh = createVoxelHumanoid({
    suitColor: playerSkinState.suitColor,
    accentColor: playerSkinState.accentColor,
    skinColor: playerSkinState.skinColor,
    emissive: playerSkinState.emissive,
    emissiveIntensity: playerSkinState.emissiveIntensity,
    visorColor: playerSkinState.visorColor,
    showMuzzleGauntlet: true,
  }).group;
  scene.add(player.mesh);
  applySkinToPlayerMesh();
  initSkinUi();

  // Enemies - voxel humans (pool size matches WAVE_CONFIG.maxEnemies = 20)
  const ENEMY_POOL_SIZE = 20;
  const enemyColors = [0xff3344, 0xff6622, 0xee2266, 0xff4444, 0xcc3355,
                        0xff5533, 0xdd2244, 0xff3366, 0xee4422, 0xff2255];
  const enemyAccent = [0xffa07a, 0xffb86b, 0xff8aa1, 0xff9077, 0xea8ca2];
  const enemySpawns = [];
  for (let i = 0; i < ENEMY_POOL_SIZE; i++) {
    const angle = (i / ENEMY_POOL_SIZE) * Math.PI * 2;
    enemySpawns.push([Math.cos(angle) * 20, Math.sin(angle) * 20]);
  }
  enemySpawns.forEach(([x, z], i) => {
    const col = enemyColors[i % enemyColors.length];
    const { group, bodyMesh: ebody } = createVoxelHumanoid({
      suitColor: col,
      accentColor: enemyAccent[i % enemyAccent.length],
      skinColor: 0xefbd96,
      emissive: 0x000000,
      emissiveIntensity: 0,
      visorColor: 0x1a0f10,
    });
    scene.add(group);

    // Health bar (CSS2D)
    const barContainer = document.createElement('div');
    barContainer.className = 'health-bar-container';
    const nameEl = document.createElement('div');
    nameEl.className = 'enemy-name-label';
    nameEl.textContent = '';
    barContainer.appendChild(nameEl);
    const barFill = document.createElement('div');
    barFill.className = 'health-bar-fill healthy';
    barFill.style.width = '100%';
    barContainer.appendChild(barFill);
    const label = new CSS2DObject(barContainer);
    label.position.set(0, 2.25, 0);
    group.add(label);

    enemies.push({
      pos: new THREE.Vector3(x, 0.6, z),
      vel: new THREE.Vector3(),
      yaw: 0,
      mesh: group,
      bodyMesh: ebody,
      alive: true,
      hp: 100,
      maxHp: 100,
      attackCooldown: 0,
      status: createDefaultStatus(),
      barFill,
      nameEl,
    });
  });

  // Init reactive arena props
  initArenaProps();

  // Init sandbox with references
  initSandbox(scene, camera, player, enemies, () => playerYaw, () => getPlayerAimPoint(), { triggerSlowMo, triggerFlash }, arenaProps);
  MatchMemory.setWeaponGetter(getActiveWeaponName);

  // Init forge UI
  initForge({
    onOpen: () => { mouseDown = false; },
    onClose: () => {},
  });

  // Load saved weapons
  loadSavedWeapons();

  // Progression
  initProgression();
  initArenaGod();
  initMutations(scene, coverBlockMeshes, player, enemies);

  // Init narrator
  initNarrator();

  // Hazard damage listener
  GameState.on('hazard_player_hit', () => {
    triggerFlash(0.15);
    updatePlayerHealthBar();
    if (player.hp <= 0) playerDeath();
  });

  // Narrator hooks
  GameState.on('wave_clear', (data) => {
    setTimeout(() => {
      getNarratorLine('wave_clear', `wave ${GameState.wave} cleared`).then(r => {
        if (r?.line) showNarratorLine(r.line, r.mood);
      });
    }, 2500); // Delay after Arena God
  });
  GameState.on('multi_kill', () => {
    getNarratorLine('multi_kill', 'multiple enemies killed rapidly').then(r => {
      if (r?.line) showNarratorLine(r.line, r.mood);
    });
  });
  GameState.on('player_near_death', () => {
    getNarratorLine('near_death', 'player at critical health').then(r => {
      if (r?.line) showNarratorLine(r.line, r.mood, 4000);
    });
  });

  refreshLevelHUD();
  applyCrosshairReward();

  // ── Avatar Selection: defer game start until avatar chosen ──
  initAvatarUI((avatarConfig) => {
    // Apply avatar to player mesh
    applyAvatarConfig(player.mesh, avatarConfig);

    // Show avatar personality as narrator line
    if (avatarConfig.personality) {
      showNarratorLine(avatarConfig.personality, 'epic', 3000);
    }

    // Pre-generate damage mutations in background
    preGenerateMutations(avatarConfig.name);

    // Pre-warm narrator cache in background
    preWarmNarrator();

    // Generate arena (non-blocking, applies when ready)
    generateArenaConfig(1, avatarConfig.name).then(arenaConfig => {
      if (arenaConfig && arenaConfig.theme.name !== 'Default Arena') {
        buildArenaFromConfig(scene, arenaConfig, coverBlockMeshes, [
          ...cameraCollisionMeshes,
          ...aimCollisionMeshes,
        ]);
        // Show arena name via narrator
        if (arenaConfig.narrativeIntro) {
          setTimeout(() => showNarratorLine(arenaConfig.narrativeIntro, 'ominous', 4000), 3500);
        }
      }
    });

    // Start the game
    initWaves(scene, enemies, null);
    setTimeout(() => startNextWave(), 1500);
  });
  showAvatarUI();

  // Input
  setupInput();
  document.getElementById('restart-btn')?.addEventListener('click', restartGame);
  document.getElementById('chronicle-share-btn')?.addEventListener('click', () => {
    const title = document.getElementById('chronicle-title')?.textContent || '';
    const text = document.getElementById('chronicle-text')?.textContent || '';
    const moment = document.getElementById('chronicle-moment')?.textContent || '';
    const full = `${title}\n\n${text}\n\n${moment}\n\n— Voxel Arena`;
    navigator.clipboard.writeText(full).then(() => {
      const btn = document.getElementById('chronicle-share-btn');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy Chronicle', 2000); }
    });
  });
  syncCrosshairToAim();

  // Game loop
  let last = performance.now();
  (function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tickFrame();

    // Slow-mo
    if (slowMoTimer > 0) {
      slowMoTimer -= dt;
      dt *= slowMoScale;
    }

    // Screen flash decay
    if (flashAlpha > 0) {
      flashEl().style.opacity = flashAlpha;
      flashAlpha *= 0.85;
      if (flashAlpha < 0.01) flashAlpha = 0;
    } else {
      flashEl().style.opacity = 0;
    }

    if (!isForgeOpen() && GameState.phase === 'playing' && player.hp > 0) {
      updateAimLocomotion(dt);
      updatePlayer(dt);
      if (mouseDown) fire();
    }
    if (GameState.phase === 'playing') updateEnemies(dt);
    updateEntities(dt);
    updateTrails(dt);
    updateSandboxTimers(dt);
    updateParticles(dt);
    updateAvatarEffects(player.mesh, dt);
    updateDamageEffects(player.mesh, dt);
    updateHealthBars();
    updateWaves(dt);
    updateMutations(dt);
    updateCamera(dt);

    if (composer) composer.render();
    else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  })();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
    syncCrosshairToAim();
  });
}

// ══════════════════════════════════════════════════
// HEALTH BARS
// ══════════════════════════════════════════════════
function updateHealthBars() {
  for (const e of enemies) {
    if (e.alive === false) continue;
    const pct = Math.max(0, e.hp / e.maxHp) * 100;
    if (e._lastPct === pct) continue;
    e._lastPct = pct;
    e.barFill.style.width = pct + '%';
    e.barFill.className = 'health-bar-fill ' + (pct > 60 ? 'healthy' : pct > 30 ? 'mid' : 'low');
  }
}

function updatePlayerHealthBar() {
  const pct = Math.max(0, player.hp / player.maxHp) * 100;
  const fill = document.getElementById('player-health-fill');
  const text = document.getElementById('player-health-text');
  if (fill) {
    fill.style.width = pct + '%';
    fill.style.background = pct > 60 ? '#44ff66' : pct > 30 ? '#ffaa22' : '#ff3344';
  }
  if (text) text.textContent = Math.ceil(player.hp);
}

function playerDeath() {
  saveSessionSummary();
  player.hp = 0;
  updatePlayerHealthBar();
  GameState.gameOver();
  onGameOver();
  triggerSlowMo(1.0, 0.2);
  triggerFlash(0.5);
  const overlay = document.getElementById('game-over-overlay');
  if (overlay) {
    overlay.classList.add('active');
    document.getElementById('game-over-score').textContent = GameState.score;
  }
  generateChronicle().then(chronicle => {
    if (chronicle) displayChronicle(chronicle);
  });
}

function restartGame() {
  hideChronicle();
  GameState.restart();
  MatchMemory.reset();
  player.hp = player.maxHp;
  player.pos.set(0, 0.6, 0);
  player.vel.set(0, 0, 0);
  player.invulnTimer = 0;
  updatePlayerHealthBar();
  const overlay = document.getElementById('game-over-overlay');
  if (overlay) overlay.classList.remove('active');
  for (const e of enemies) {
    e.hp = e.maxHp;
    e.pos.set((Math.random() - 0.5) * 60, 0.6, (Math.random() - 0.5) * 60);
    e.vel.set(0, 0, 0);
    e.mesh.visible = true;
    e.attackCooldown = 0;
  }
  // Reset damage mutations
  clearDamageMutations(player.mesh);
  clearMutationCache();

  // Reset reactive arena props
  for (const c of arenaProps) {
    c.hp = c.maxHp;
    c.alive = true;
    c.vel.set(0, 0, 0);
    c.pos.copy(c.originalPos);
    c.mesh.visible = true;
    c.mesh.position.copy(c.originalPos);
    if (c.status) clearStatus(c.status);
    for (const mesh of c.fadeMeshes || c.reactiveMeshes || [c.bodyMesh]) {
      if (!mesh?.material) continue;
      mesh.material.opacity = 1;
      mesh.material.transparent = false;
      if (mesh.material.emissive) {
        mesh.material.emissive.set(0x000000);
        mesh.material.emissiveIntensity = 0;
      }
    }
  }
}

// ══════════════════════════════════════════════════
// PLAYER
// ══════════════════════════════════════════════════
function updatePlayer(dt) {
  if (player.invulnTimer > 0) player.invulnTimer -= dt;
  _playerFwd.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
  _playerRgt.set(Math.cos(playerYaw), 0, -Math.sin(playerYaw));
  const a = 40, drag = 5;
  _playerForce.set(0, 0, 0);

  if (keys['w'] || keys['arrowup']) _playerForce.addScaledVector(_playerFwd, a);
  if (keys['s'] || keys['arrowdown']) _playerForce.addScaledVector(_playerFwd, -a);
  if (keys['a']) _playerForce.addScaledVector(_playerRgt, -a);
  if (keys['d']) _playerForce.addScaledVector(_playerRgt, a);
  if (keys['shift']) _playerForce.multiplyScalar(1.8);

  player.vel.addScaledVector(_playerForce, dt);
  player.vel.multiplyScalar(1 - drag * dt);
  player.pos.addScaledVector(player.vel, dt);
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -48, 48);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -48, 48);
  player.pos.y = 0.6;
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = playerYaw;
  animateHumanoid(player.mesh, dt, Math.hypot(player.vel.x, player.vel.z), {
    localForward: player.vel.dot(_playerFwd),
    localRight: player.vel.dot(_playerRgt),
  });
}

// ══════════════════════════════════════════════════
// ENEMY TAUNTS
// ══════════════════════════════════════════════════
function showEnemyTaunt(e) {
  if (!e.identity?.taunt) return;
  const el = document.createElement('div');
  el.className = 'enemy-taunt';
  el.textContent = `"${e.identity.taunt}"`;
  const screenPos = e.pos.clone().add(new THREE.Vector3(0, 2.5, 0)).project(camera);
  el.style.left = ((screenPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-screenPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ══════════════════════════════════════════════════
// ENEMIES
// ══════════════════════════════════════════════════
function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.alive === false) continue;
    const s = e.status || (e.status = createDefaultStatus());
    const frozen = s.freeze > 0;
    const stunned = s.stun > 0;
    const slowScale = s.slowTime > 0 ? THREE.MathUtils.clamp(s.slowMult ?? 1, 0, 1) : 1;

    const dx = player.pos.x - e.pos.x;
    const dz = player.pos.z - e.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Skip complex AI for enemies beyond 80 units
    if (dist > 80) {
      e.mesh.position.copy(e.pos);
      continue;
    }

    if (frozen) {
      e.vel.set(0, 0, 0);
      e.pos.y = Math.max(e.pos.y, 0.6);
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.y = e.yaw;
      animateHumanoid(e.mesh, dt, 0, { frozen: true });
      continue;
    }

    if (!stunned) {
      updateEnemyAI(e, player, enemies, dt, slowScale * (e.speedBuff || 1));
    }

    // Gravity pulls enemies down when airborne
    if (e.pos.y > 0.6) {
      e.vel.y -= 20 * dt; // gravity
    } else {
      // On ground: apply ground friction, reset Y
      e.vel.x *= (1 - 3 * dt);
      e.vel.z *= (1 - 3 * dt);
      if (e.vel.y < 0) e.vel.y = 0;
      e.pos.y = 0.6;
    }

    // Air drag (lighter than ground friction)
    if (e.pos.y > 0.6) {
      e.vel.x *= (1 - 1 * dt);
      e.vel.z *= (1 - 1 * dt);
    }

    // Slow applies extra horizontal damping so frozen/slow effects feel stronger.
    if (slowScale < 1) {
      const slowDamp = 1 - Math.min(0.95, (1 - slowScale) * 4 * dt);
      e.vel.x *= slowDamp;
      e.vel.z *= slowDamp;
    }

    e.pos.addScaledVector(e.vel, dt);
    e.pos.x = THREE.MathUtils.clamp(e.pos.x, -48, 48);
    e.pos.z = THREE.MathUtils.clamp(e.pos.z, -48, 48);
    if (e.pos.y < 0.6) e.pos.y = 0.6;
    if (dist > 0.5) e.yaw = Math.atan2(dx, dz);
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = e.yaw;
    animateHumanoid(e.mesh, dt, Math.hypot(e.vel.x, e.vel.z));

    // Taunt on first aggro
    if (dist < 15 && e.identity && !e.identity.hasTaunted) {
      e.identity.hasTaunted = true;
      showEnemyTaunt(e);
    }

    // Melee attack
    const attackRange = e.typeConfig?.attackRange || 2.5;
    if (!frozen && !stunned && dist < attackRange) {
      e.attackCooldown = (e.attackCooldown ?? 0) - dt;
      if (e.attackCooldown <= 0) {
        e.attackCooldown = e.typeConfig?.attackCooldown || 1.2;
        const dmg = e.typeConfig?.damage || 10;
        if (player.invulnTimer <= 0 && player.hp > 0) {
          player.hp -= dmg;
          MatchMemory.recordPlayerHit(dmg, player.hp);
          playPlayerHit();
          player.invulnTimer = 0.3;
          triggerFlash(0.2);
          setShake(0.4, 0.2);
          updatePlayerHealthBar();

          // Damage-reactive avatar mutations
          const healthPct = (player.hp / player.maxHp) * 100;
          const threshold = checkDamageThreshold(healthPct);
          if (threshold) {
            getDamageMutation(getAvatarConcept(), healthPct).then(mutation => {
              if (mutation) applyDamageMutation(player.mesh, mutation);
            });
          }

          if (player.hp <= 0) {
            playerDeath();
          }
        }
      }
    }
  }
}

// ══════════════════════════════════════════════════
// ENEMY OBJECT POOLING
// ══════════════════════════════════════════════════
export function respawnEnemy(x, z, hp = 100, typeConfig = null) {
  const dead = enemies.find(e => e.hp <= 0);
  if (!dead) return null;
  if (typeConfig) {
    dead.typeConfig = typeConfig;
    dead.typeName = typeConfig.name;
  }
  dead.hp = hp;
  dead.maxHp = hp;
  dead.alive = true;
  dead.pos.set(x, 0.6, z);
  dead.vel.set(0, 0, 0);
  dead.yaw = 0;
  dead.attackCooldown = 0;
  dead.mesh.visible = true;
  dead.mesh.position.copy(dead.pos);
  if (dead.status) {
    clearStatus(dead.status);
  }
  dead.bodyMesh.material.emissive.set(0x000000);
  dead.bodyMesh.material.emissiveIntensity = 0;
  return dead;
}

// ══════════════════════════════════════════════════
// CAMERA
// ══════════════════════════════════════════════════
function updateCamera(dt) {
  const p = player.pos;
  tempCameraForward.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
  tempCameraRight.set(Math.cos(playerYaw), 0, -Math.sin(playerYaw));

  tempCameraPivot.copy(p).addScaledVector(WORLD_UP, CAMERA_RIG.pivotHeight);
  tempCameraShoulder.copy(tempCameraPivot)
    .addScaledVector(tempCameraRight, CAMERA_RIG.shoulderRight)
    .addScaledVector(WORLD_UP, CAMERA_RIG.shoulderUp);

  tempCameraDesired.copy(tempCameraShoulder)
    .addScaledVector(tempCameraForward, CAMERA_RIG.shoulderForward - CAMERA_RIG.distance)
    .addScaledVector(WORLD_UP, CAMERA_RIG.followHeight);

  let resolvedDistance = CAMERA_RIG.distance;
  tempCameraRayDir.copy(tempCameraDesired).sub(tempCameraShoulder);
  const desiredLength = tempCameraRayDir.length();
  if (desiredLength > 0.001 && cameraCollisionMeshes.length > 0) {
    tempCameraRayDir.multiplyScalar(1 / desiredLength);
    cameraCollisionRay.set(tempCameraShoulder, tempCameraRayDir);
    cameraCollisionRay.far = desiredLength;
    const hits = cameraCollisionRay.intersectObjects(cameraCollisionMeshes, false);
    if (hits.length > 0) {
      const safeDistance = Math.max(CAMERA_RIG.minDistance, hits[0].distance - CAMERA_RIG.collisionPadding);
      tempCameraDesired.copy(tempCameraShoulder).addScaledVector(tempCameraRayDir, safeDistance);
      resolvedDistance = safeDistance;
    }
  }

  tempCameraLookAt.copy(p)
    .addScaledVector(tempCameraRight, CAMERA_RIG.shoulderRight * 0.45)
    .addScaledVector(WORLD_UP, CAMERA_RIG.lookHeight)
    .addScaledVector(
      tempCameraForward,
      Math.max(CAMERA_RIG.minDistance + 1.2, CAMERA_RIG.lookAhead * (resolvedDistance / CAMERA_RIG.distance))
    );

  const posAlpha = dt > 0 ? dampFactor(CAMERA_RIG.positionSharpness, dt) : 1;
  const lookAlpha = dt > 0 ? dampFactor(CAMERA_RIG.lookSharpness, dt) : 1;
  if (!cameraState.initialized) {
    cameraState.position.copy(tempCameraDesired);
    cameraState.lookAt.copy(tempCameraLookAt);
    cameraState.initialized = true;
  } else {
    cameraState.position.lerp(tempCameraDesired, posAlpha);
    cameraState.lookAt.lerp(tempCameraLookAt, lookAlpha);
  }

  camera.position.copy(cameraState.position);

  const shake = getShake();
  if (shake.time > 0) {
    tickShake(dt);
    camera.position.x += (Math.random() - 0.5) * shake.amt;
    camera.position.y += (Math.random() - 0.5) * shake.amt * 0.5;
    camera.position.z += (Math.random() - 0.5) * shake.amt;
  }

  camera.lookAt(cameraState.lookAt);
}

// ══════════════════════════════════════════════════
// INPUT
// ══════════════════════════════════════════════════
function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function setupInput() {
  window.addEventListener('keydown', (e) => {
    if (isForgeOpen() || window._blockGameInput) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key >= '1' && e.key <= '4') {
      switchWeapon(parseInt(e.key) - 1);
    }
    if (e.key === 't' || e.key === 'T') openForge();
    if (e.key === 'c' || e.key === 'C') cyclePlayerSkinPreset();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (isForgeOpen()) return;
    if (e.button === 0) mouseDown = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
  window.addEventListener('mousemove', (e) => { updateAimFromMouseEvent(e); });

  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ══════════════════════════════════════════════════
// API KEY GATE
// ══════════════════════════════════════════════════
init();
