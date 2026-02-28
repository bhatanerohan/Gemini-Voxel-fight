import * as THREE from 'three';
import { GameState } from './gameState.js';
import { applyTheme, PRESETS, getCurrentThemeName } from './themeManager.js';
import { getCombatModifiersForWave } from './relicCodex.js';

// ── State ──
let _scene = null;
let _coverBlocks = [];
let _hazardZones = [];
let _player = null;
let _enemies = null;
let _removedCount = 0;
let _removedBlocks = []; // { mesh, originalScaleY, originalPosY }
let _elapsed = 0;

const MAX_COVER_REMOVALS = 4;
const MAX_HAZARDS = 3;
const HAZARD_RADIUS = 5;
const HAZARD_DAMAGE = 3;
const HAZARD_DAMAGE_INTERVAL = 0.5;

// ── Sinking animations ──
let _sinkingBlocks = []; // { mesh, originalScaleY, originalPosY, timer, duration }

export function initMutations(scene, coverBlocks, player, enemies) {
  _scene = scene;
  _coverBlocks = coverBlocks;
  _player = player;
  _enemies = enemies;
  _removedCount = 0;
  _removedBlocks = [];
  _hazardZones = [];
  _sinkingBlocks = [];
  _elapsed = 0;

  GameState.on('god_mutation', (mutation) => executeMutation(mutation));
  GameState.on('god_enemy_modifier', (mod) => applyEnemyModifier(mod));
  GameState.on('restart', () => resetMutations());
}

function executeMutation(mutation) {
  switch (mutation.type) {
    case 'remove_cover':
      removeCover();
      break;
    case 'add_hazard':
      addHazard();
      break;
    case 'theme_shift':
      themeShift();
      break;
    case 'shrink_arena':
      console.log('[ArenaMutation] shrink_arena not implemented in v1');
      break;
    case 'spawn_champion':
      console.log('[ArenaMutation] spawn_champion:', mutation.detail);
      GameState.emit('spawn_champion', mutation.detail);
      break;
    default:
      console.log('[ArenaMutation] Unknown mutation type:', mutation.type);
  }
}

function removeCover() {
  if (_removedCount >= MAX_COVER_REMOVALS) return;

  const visible = _coverBlocks.filter(m => m.visible && !_sinkingBlocks.find(s => s.mesh === m));
  if (visible.length === 0) return;

  const mesh = visible[Math.floor(Math.random() * visible.length)];
  const originalScaleY = mesh.scale.y;
  const originalPosY = mesh.position.y;

  _removedBlocks.push({ mesh, originalScaleY, originalPosY });
  _sinkingBlocks.push({ mesh, originalScaleY, originalPosY, timer: 0, duration: 0.8 });
  _removedCount++;
}

function addHazard() {
  if (_hazardZones.length >= MAX_HAZARDS) return;
  if (!_scene || !_player) return;

  // Find a position not too close to player and not overlapping existing hazards
  let x, z;
  let attempts = 0;
  do {
    x = (Math.random() - 0.5) * 80;
    z = (Math.random() - 0.5) * 80;
    attempts++;
  } while (attempts < 30 && (
    Math.hypot(x - _player.pos.x, z - _player.pos.z) < 8 ||
    _hazardZones.some(h => Math.hypot(x - h.mesh.position.x, z - h.mesh.position.z) < HAZARD_RADIUS * 2)
  ));

  const geo = new THREE.CircleGeometry(HAZARD_RADIUS, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff2200,
    emissive: 0xff4400,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.05, z);
  _scene.add(mesh);

  // Add a ring outline
  const ringGeo = new THREE.RingGeometry(HAZARD_RADIUS - 0.15, HAZARD_RADIUS, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xff6600,
    emissive: 0xff4400,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.06, z);
  _scene.add(ring);

  _hazardZones.push({
    mesh,
    ring,
    material: mat,
    ringMaterial: ringMat,
    age: 0,
    damageCooldown: 0,
    x, z,
  });
}

function themeShift() {
  const keys = Object.keys(PRESETS);
  const current = getCurrentThemeName();
  const others = keys.filter(k => PRESETS[k].name !== current);
  const pick = others[Math.floor(Math.random() * others.length)] || keys[0];
  applyTheme(PRESETS[pick]);
}

export function updateMutations(dt) {
  _elapsed += dt;

  // Update sinking animations
  for (let i = _sinkingBlocks.length - 1; i >= 0; i--) {
    const s = _sinkingBlocks[i];
    s.timer += dt;
    const t = Math.min(1, s.timer / s.duration);
    s.mesh.scale.y = s.originalScaleY * (1 - t);
    // Sink the position so it goes into the ground
    s.mesh.position.y = s.originalPosY * (1 - t);
    if (t >= 1) {
      s.mesh.visible = false;
      s.mesh.scale.y = s.originalScaleY; // restore scale for reset
      s.mesh.position.y = s.originalPosY;
      _sinkingBlocks.splice(i, 1);
    }
  }

  // Update hazard zones
  for (const h of _hazardZones) {
    h.age += dt;
    h.damageCooldown -= dt;

    // Pulsing glow
    const pulse = 0.4 + Math.sin(h.age * 3) * 0.3;
    h.material.emissiveIntensity = pulse;
    h.material.opacity = 0.35 + Math.sin(h.age * 3) * 0.2;
    h.ringMaterial.emissiveIntensity = pulse + 0.2;

    // Player damage
    if (_player && _player.hp > 0 && _player.invulnTimer <= 0 && h.damageCooldown <= 0) {
      const dx = _player.pos.x - h.x;
      const dz = _player.pos.z - h.z;
      if (Math.hypot(dx, dz) < HAZARD_RADIUS) {
        const incomingDamageMult = getCombatModifiersForWave(GameState.wave).incomingDamageMult || 1;
        const hazardDamage = HAZARD_DAMAGE * incomingDamageMult;
        _player.hp -= hazardDamage;
        _player.invulnTimer = HAZARD_DAMAGE_INTERVAL;
        h.damageCooldown = HAZARD_DAMAGE_INTERVAL;
        GameState.emit('hazard_player_hit', { damage: hazardDamage });
      }
    }
  }
}

function applyEnemyModifier(mod) {
  if (!_enemies) return;
  for (const e of _enemies) {
    if (!e.alive) continue;
    // Respect target filter from arena god
    const target = mod.target || 'all';
    if (target !== 'all' && target.startsWith('type:')) {
      const targetType = target.slice(5).toLowerCase();
      if ((e.typeConfig?.name || 'Grunt').toLowerCase() !== targetType) continue;
    }
    switch (mod.type) {
      case 'resistance':
        e.resistType = mod.detail;
        break;
      case 'speed_buff':
        e.speedBuff = 1.5;
        break;
      case 'rage':
        // Reduce attack cooldown by 30%
        if (e.attackCooldown > 0) e.attackCooldown *= 0.7;
        break;
    }
  }
}

function resetMutations() {
  // Restore removed cover blocks
  for (const rb of _removedBlocks) {
    rb.mesh.visible = true;
    rb.mesh.scale.y = rb.originalScaleY;
    rb.mesh.position.y = rb.originalPosY;
  }
  _removedBlocks = [];
  _removedCount = 0;
  _sinkingBlocks = [];

  // Remove hazard zones
  for (const h of _hazardZones) {
    if (_scene) {
      _scene.remove(h.mesh);
      _scene.remove(h.ring);
    }
    h.mesh.geometry.dispose();
    h.material.dispose();
    h.ring.geometry.dispose();
    h.ringMaterial.dispose();
  }
  _hazardZones = [];

  // Reset theme to neon via themeManager
  applyTheme(PRESETS.neon);

  _elapsed = 0;
}
