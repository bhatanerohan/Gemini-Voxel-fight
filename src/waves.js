// src/waves.js — Wave-based enemy spawner
import * as THREE from 'three';
import { GameState } from './gameState.js';
import { updateWave, showWaveAnnounce, showWaveClear, showMessage } from './hud.js';
import { playWaveStart } from './audio.js';
import { MatchMemory } from './matchMemory.js';
import { generateEnemyIdentities, applyIdentity } from './enemyIdentity.js';
import { pickEnemyType, getTypeConfig } from './enemyTypes.js';
import { clearStatus } from './statusEffects.js';

let _scene = null;
let _enemies = [];
let _createEnemyFn = null;
let restTimer = 0;
let waveActive = false;
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

  GameState.on('restart', () => {
    waveActive = false;
    restTimer = 0;
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

  // Calculate enemy count for this wave
  const count = Math.min(
    WAVE_CONFIG.baseCount + (wave - 1) * WAVE_CONFIG.countPerWave,
    WAVE_CONFIG.maxEnemies
  );
  const hp = WAVE_CONFIG.baseHp + (wave - 1) * WAVE_CONFIG.hpPerWave;
  const speedMult = WAVE_CONFIG.baseSpeed + (wave - 1) * WAVE_CONFIG.speedPerWave;

  // Spawn/reuse enemies
  spawnWaveEnemies(count, hp, speedMult);
  waveActive = true;

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

function spawnWaveEnemies(count, hp, speedMult) {
  const wave = GameState.wave;
  // Reuse existing enemy objects or note we need more
  for (let i = 0; i < _enemies.length; i++) {
    if (i < count) {
      const e = _enemies[i];
      e.identity = null;
      if (e.nameEl) e.nameEl.textContent = '';

      // Assign enemy type based on wave composition
      const typeName = pickEnemyType(wave);
      const typeConfig = getTypeConfig(typeName);
      e.typeConfig = typeConfig;
      e.typeName = typeName;

      // Scale HP from type base + wave scaling
      e.hp = typeConfig.hp + (wave - 1) * WAVE_CONFIG.hpPerWave;
      e.maxHp = e.hp;

      e.alive = true;
      e.mesh.visible = true;
      e.attackCooldown = 0;
      e.vel.set(0, 0, 0);
      // Clear arena god modifiers from previous wave
      e.resistType = null;
      e.speedBuff = 1;

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
      if (GameState.wave >= 2) {
        showMessage('Press T to forge a weapon!', 3000);
      }
    }
  } else if (GameState.phase === 'waveBreak') {
    restTimer -= dt;
    if (restTimer <= 0) {
      startNextWave();
    }
  }
}

export function isWaveActive() { return waveActive; }
