// src/waves.js — Wave-based enemy spawner
import * as THREE from 'three';
import { GameState } from './gameState.js';
import { updateWave, showWaveAnnounce, showWaveClear, showMessage } from './hud.js';
import { playWaveStart } from './audio.js';
import { MatchMemory } from './matchMemory.js';
import { generateEnemyIdentities, applyIdentity } from './enemyIdentity.js';
import { pickEnemyType, getTypeConfig } from './enemyTypes.js';
import { clearStatus } from './statusEffects.js';
import { getAiBalanceProfile } from './aiBalancer.js';
import { getEnemyWaveModifiersForWave } from './relicCodex.js';

let _scene = null;
let _enemies = [];
let _createEnemyFn = null;
let restTimer = 0;
let waveActive = false;
let intermissionLocked = false;
const REST_DURATION = 6; // seconds between waves

const WAVE_CONFIG = {
  baseCount: 4,
  countPerWave: 2,
  maxEnemies: 20,
  baseHp: 80,
  hpPerWave: 15,
  baseSpeed: 1.0,
  speedPerWave: 0.05,
  spawnMinDist: 25,
  spawnMaxDist: 45,
};

export function initWaves(scene, enemies, createEnemyFn) {
  _scene = scene;
  _enemies = enemies;
  _createEnemyFn = createEnemyFn;
  waveActive = false;
  restTimer = 0;
  intermissionLocked = false;

  GameState.on('restart', () => {
    waveActive = false;
    restTimer = 0;
    intermissionLocked = false;
    // Clear all enemies
    for (const e of _enemies) {
      e.mesh.visible = false;
      e.alive = false;
    }
    // Start wave 1 after brief delay
    setTimeout(() => startNextWave(), 500);
  });
}

export function startNextWave() {
  const wave = GameState.wave + 1;
  GameState.startWave(wave);
  MatchMemory.recordWaveStart(wave);
  updateWave(wave);
  showWaveAnnounce(wave);
  playWaveStart();

  const balance = getAiBalanceProfile();
  const decreeEffects = getEnemyWaveModifiersForWave(wave);
  const effectiveBalance = {
    ...balance,
    spawnCountMult: (balance.spawnCountMult || 1) * (decreeEffects.spawnCountMult || 1),
    enemyHpMult: (balance.enemyHpMult || 1) * (decreeEffects.enemyHpMult || 1),
    enemySpeedMult: (balance.enemySpeedMult || 1) * (decreeEffects.enemySpeedMult || 1),
    enemyDamageMult: (balance.enemyDamageMult || 1) * (decreeEffects.enemyDamageMult || 1),
    enemyCooldownMult: (balance.enemyCooldownMult || 1) * (decreeEffects.enemyCooldownMult || 1),
  };

  // Calculate enemy count for this wave
  const baseCount = WAVE_CONFIG.baseCount + (wave - 1) * WAVE_CONFIG.countPerWave;
  const count = Math.min(
    WAVE_CONFIG.maxEnemies,
    Math.max(1, Math.round(baseCount * (effectiveBalance.spawnCountMult || 1)))
  );
  const hp = (WAVE_CONFIG.baseHp + (wave - 1) * WAVE_CONFIG.hpPerWave) * (effectiveBalance.enemyHpMult || 1);
  const speedMult = (WAVE_CONFIG.baseSpeed + (wave - 1) * WAVE_CONFIG.speedPerWave) * (effectiveBalance.enemySpeedMult || 1);

  // Spawn/reuse enemies
  spawnWaveEnemies(count, hp, speedMult, effectiveBalance);
  waveActive = true;
  intermissionLocked = false;

  // Guaranteed boss moments so learning champion appears even without Arena God mutation.
  if (wave >= 3 && wave % 3 === 0) {
    GameState.emit('spawn_champion', `Wave ${wave} champion adapts to your habits.`);
  }

  // Generate identities asynchronously (fire-and-forget)
  if (wave >= 2) {
    generateEnemyIdentities(wave, count).then(identities => {
      if (!identities.length) return;
      const activeEnemies = _enemies.filter(e => e.alive);
      for (let i = 0; i < activeEnemies.length && i < identities.length; i++) {
        applyIdentity(activeEnemies[i], identities[i]);
        if (activeEnemies[i].nameEl) {
          activeEnemies[i].nameEl.textContent = activeEnemies[i].identity.fullName;
        }
      }
    });
  }
}

function cloneTypeConfig(config) {
  if (!config || typeof config !== 'object') return {};
  const out = { ...config };
  if (config.colors) out.colors = { ...config.colors };
  if (config.dash) out.dash = { ...config.dash };
  if (config.projectile) out.projectile = { ...config.projectile };
  return out;
}

function spawnWaveEnemies(count, hp, speedMult, balanceProfile = null) {
  const wave = GameState.wave;
  const hpMult = Math.max(0.1, Number(balanceProfile?.enemyHpMult) || 1);
  const damageMult = Math.max(0.1, Number(balanceProfile?.enemyDamageMult) || 1);
  const cooldownMult = Math.max(0.1, Number(balanceProfile?.enemyCooldownMult) || 1);

  // Reuse existing enemy objects or note we need more
  for (let i = 0; i < _enemies.length; i++) {
    if (i < count) {
      const e = _enemies[i];
      e.identity = null;
      e.isChampion = false;
      e.championState = null;
      e.championCombat = null;
      if (e.nameEl) e.nameEl.textContent = '';

      // Assign enemy type based on wave composition
      const typeName = pickEnemyType(wave);
      const baseType = getTypeConfig(typeName);
      const typeConfig = cloneTypeConfig(baseType);
      typeConfig.damage = Math.max(1, Math.round((typeConfig.damage || 1) * damageMult));
      typeConfig.attackCooldown = Math.max(0.35, (typeConfig.attackCooldown || 1.2) * cooldownMult);
      if (typeConfig.projectile?.damage) {
        typeConfig.projectile.damage = Math.max(1, Math.round(typeConfig.projectile.damage * damageMult));
      }
      e.typeConfig = typeConfig;
      e.typeName = typeName;

      // Scale HP from type base + wave scaling
      const typeHpOffset = (typeConfig.hp || WAVE_CONFIG.baseHp) - WAVE_CONFIG.baseHp;
      e.hp = Math.max(10, Math.round(hp + typeHpOffset * hpMult));
      e.maxHp = e.hp;

      e.alive = true;
      e.mesh.visible = true;
      e.attackCooldown = 0;
      e.vel.set(0, 0, 0);
      // Clear arena god modifiers from previous wave
      e.resistType = null;
      e.speedBuff = speedMult;

      // Apply type-specific visuals
      if (e.mesh.userData.rig?.root) {
        e.mesh.userData.rig.root.scale.setScalar(typeConfig.scale);
      }
      e.bodyMesh.material.color.setHex(typeConfig.colors.suit);
      // Spawn at random position around arena edge
      const angle = Math.random() * Math.PI * 2;
      const dist = WAVE_CONFIG.spawnMinDist + Math.random() * (WAVE_CONFIG.spawnMaxDist - WAVE_CONFIG.spawnMinDist);
      e.pos.set(
        Math.cos(angle) * dist,
        0.6,
        Math.sin(angle) * dist
      );
      e.pos.x = THREE.MathUtils.clamp(e.pos.x, -45, 45);
      e.pos.z = THREE.MathUtils.clamp(e.pos.z, -45, 45);
      e.mesh.position.copy(e.pos);
      // Clear status effects
      if (e.status) {
        clearStatus(e.status);
      }
    } else {
      // Hide extra enemies
      _enemies[i].alive = false;
      _enemies[i].mesh.visible = false;
      _enemies[i].isChampion = false;
      _enemies[i].championState = null;
      _enemies[i].championCombat = null;
    }
  }
}

export function updateWaves(dt) {
  if (GameState.phase === 'gameOver') return;

  if (waveActive) {
    // Check if all enemies are dead
    let aliveCount = 0;
    for (let i = 0; i < _enemies.length; i++) { if (_enemies[i].alive) aliveCount++; }
    if (aliveCount === 0) {
      // Wave cleared!
      waveActive = false;
      MatchMemory.recordWaveClear(GameState.wave);
      GameState.endWave();
      showWaveClear();
      GameState.addScore(GameState.wave * 100); // wave clear bonus
      restTimer = REST_DURATION;
      if (GameState.wave >= 1) {
        showMessage('Relic dropped: decode and choose one decree.', 3200);
      }
    }
  } else if (GameState.phase === 'waveBreak') {
    if (intermissionLocked) return;
    restTimer -= dt;
    if (restTimer <= 0) {
      startNextWave();
    }
  }
}

export function isWaveActive() { return waveActive; }
export function setWaveBreakLock(locked) { intermissionLocked = !!locked; }
