// src/waves.js — Wave-based enemy spawner
import * as THREE from 'three';
import { GameState } from './gameState.js';
import { updateWave, showWaveAnnounce, showWaveClear, showMessage } from './hud.js';
import { playWaveStart } from './audio.js';

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
}

function spawnWaveEnemies(count, hp, speedMult) {
  // Reuse existing enemy objects or note we need more
  for (let i = 0; i < _enemies.length; i++) {
    if (i < count) {
      const e = _enemies[i];
      e.hp = hp;
      e.maxHp = hp;
      e.alive = true;
      e.mesh.visible = true;
      e.attackCooldown = 0;
      e.vel.set(0, 0, 0);
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
        e.status.freeze = 0;
        e.status.stun = 0;
        e.status.slowMult = 1;
        e.status.slowTime = 0;
        e.status.burnDps = 0;
        e.status.burnTime = 0;
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
    const aliveCount = _enemies.filter(e => e.alive).length;
    if (aliveCount === 0) {
      // Wave cleared!
      waveActive = false;
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
