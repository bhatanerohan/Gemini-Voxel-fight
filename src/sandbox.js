import * as THREE from 'three';
import { Trail } from './trail.js';
import { ParticlePool } from './particles.js';
import { createWeaponSdk } from './weaponSdk/index.js';
import { createSafeContext } from './weaponValidator.js';
import { saveWeapons, loadWeapons } from './weaponStorage.js';
import { validateWeaponCode } from './weaponValidator.js';
import { GameState } from './gameState.js';
import { updateScore, updateKills, showDamageNumber } from './hud.js';
import { playHit, playEnemyDeath } from './audio.js';
import { MatchMemory } from './matchMemory.js';
import { createDefaultStatus, clearStatus, ensureStatus } from './statusEffects.js';

GameState.on('restart', () => {
  updateScore(0);
  updateKills(0);
});

// ── Tracked state ──
export const entities = [];
export const visuals = [];
export const activeLights = [];
export const trails = [];
export const cbs = [];
export const timers = [];
export const intervals = [];

export let elapsed = 0;
export let fireFn = null;
export let lastFire = 0;

let _activeWeaponVisuals = null;
export function setActiveWeaponVisuals(config) { _activeWeaponVisuals = config; }
export function getActiveWeaponVisuals() { return _activeWeaponVisuals; }

const weaponSlots = [
  { fn: null, name: '' },
  { fn: null, name: '' },
  { fn: null, name: '' },
  { fn: null, name: '' },
];
let activeSlot = 0;
export let shakeAmt = 0;
export let shakeTime = 0;
let _cachedCtx = null;
let _ctxFrame = -1;
let _frameCounter = 0;
let _cachedEnemyWraps = null;
const PLAYER_TORSO_ORIGIN_Y = 0.95;
const _torsoOrigin = new THREE.Vector3();
const _sbShootOrigin = new THREE.Vector3();
const _facingDir = new THREE.Vector3();

// References set by main.js
let _scene, _camera, _enemies, _player, _playerYaw;
let _getAimPoint = null;
let _effects = {};
let _particlePool = null;
let _crates = [];

export function initSandbox(scene, camera, player, enemies, getYaw, getAimPoint, effects = {}, crates = []) {
  _scene = scene;
  _camera = camera;
  _player = player;
  _enemies = enemies;
  _playerYaw = getYaw;
  _getAimPoint = typeof getAimPoint === 'function' ? getAimPoint : null;
  _effects = effects;
  _particlePool = new ParticlePool(scene, 800);
  _crates = crates;
}

function getPlayerAimPoint() {
  if (typeof _getAimPoint !== 'function') return null;
  const point = _getAimPoint();
  if (!point) return null;
  if (point instanceof THREE.Vector3) return point.clone();
  return new THREE.Vector3(point.x ?? 0, point.y ?? 0, point.z ?? 0);
}

function getPlayerFacingDirection(yaw) {
  return _facingDir.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function setShake(amt, time) {
  shakeAmt = amt;
  shakeTime = time;
}

export function getShake() {
  return { amt: shakeAmt, time: shakeTime };
}

function getPlayerTorsoOrigin() {
  return _torsoOrigin.copy(_player.pos).setY(_player.pos.y + PLAYER_TORSO_ORIGIN_Y);
}

function getPlayerShootOrigin() {
  const muzzleTip = _player?.mesh?.userData?.rig?.muzzleTip;
  if (muzzleTip && typeof muzzleTip.getWorldPosition === 'function') {
    return muzzleTip.getWorldPosition(_sbShootOrigin);
  }
  return getPlayerTorsoOrigin();
}

function getPlayerAimDirection(yaw) {
  const origin = getPlayerShootOrigin();
  const aimPoint = getPlayerAimPoint();
  if (aimPoint) {
    const dir = aimPoint.sub(origin);
    if (dir.lengthSq() > 1e-6) return dir.normalize();
  }
  return getPlayerFacingDirection(yaw);
}

export function tickShake(dt) {
  if (shakeTime > 0) shakeTime -= dt;
}

// ── Update particle pool (called from main loop) ──
export function updateParticles(dt) {
  if (_particlePool) _particlePool.update(dt);
}

// ── Entity management ──
export function destroyEntity(e) {
  if (!e.alive) return;
  e.alive = false;
  _scene.remove(e.mesh);
  try { if (e.mesh.geometry) e.mesh.geometry.dispose(); } catch (x) {}
  try {
    if (e.mesh.material) {
      if (Array.isArray(e.mesh.material)) e.mesh.material.forEach(m => m.dispose());
      else e.mesh.material.dispose();
    }
  } catch (x) {}
}

export function updateEntities(dt) {
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (!e.alive) { entities.splice(i, 1); continue; }
    e.age += dt;
    if (e.gravity !== 0) e.vel.y -= 9.81 * (e.gravity ?? 1) * dt;
    e.pos.addScaledVector(e.vel, dt);
    if (e.pos.y < e.radius && e.vel.y < 0) {
      e.pos.y = e.radius;
      e.vel.y *= -(e.bounce ?? 0.3);
      e.vel.x *= 0.9;
      e.vel.z *= 0.9;
    }
    if (e.angVel) {
      e.mesh.rotation.x += e.angVel.x * dt;
      e.mesh.rotation.y += e.angVel.y * dt;
      e.mesh.rotation.z += e.angVel.z * dt;
    }
    e.mesh.position.copy(e.pos);
    if (e.onUpdate) {
      try { if (e.onUpdate(dt, elapsed, e) === false) destroyEntity(e); }
      catch (err) { console.error(err); destroyEntity(e); }
    }
    if (e.lifetime && e.age > e.lifetime) destroyEntity(e);
    if (e.pos.y < -30 || Math.abs(e.pos.x) > 120 || Math.abs(e.pos.z) > 120) destroyEntity(e);
  }
}

export function updateTrails(dt) {
  for (let i = trails.length - 1; i >= 0; i--) {
    const t = trails[i];
    if (!t.alive) { trails.splice(i, 1); continue; }
    if (t.fading) {
      t.age += dt;
      if (t.age > t.fadeDuration) { t.destroy(); trails.splice(i, 1); }
      else t.update(t.points.length > 0 ? t.points[0] : new THREE.Vector3(), _camera.position);
    }
  }
}

export function updateSandboxTimers(dt) {
  elapsed += dt;
  for (let i = cbs.length - 1; i >= 0; i--) {
    try { if (cbs[i](dt, elapsed) === false) cbs.splice(i, 1); }
    catch (e) { console.error(e); cbs.splice(i, 1); }
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].r -= dt;
    if (timers[i].r <= 0) {
      try { timers[i].f(); } catch (e) { console.error(e); }
      timers.splice(i, 1);
    }
  }
  for (let i = intervals.length - 1; i >= 0; i--) {
    const v = intervals[i];
    if (v.s) { intervals.splice(i, 1); continue; }
    v.r -= dt;
    if (v.r <= 0) { v.r += v.p; try { v.f(); } catch (e) { console.error(e); } }
  }

  // Tick enemy status effects (burn/freeze/slow/stun timers)
  if (_enemies) {
    for (const e of _enemies) {
      if (e.alive === false) continue;
      const s = ensureEnemyStatus(e);

      if (s.freeze > 0) s.freeze = Math.max(0, s.freeze - dt);
      if (s.stun > 0) s.stun = Math.max(0, s.stun - dt);

      if (s.slowTime > 0) {
        s.slowTime = Math.max(0, s.slowTime - dt);
        if (s.slowTime <= 0) s.slowMult = 1;
      }

      if (s.burnTime > 0 && s.burnDps > 0) {
        s.burnTime = Math.max(0, s.burnTime - dt);
        s.burnAcc += dt;
        const tick = Math.max(0.05, s.burnTick || 0.15);

        while (s.burnAcc >= tick && s.burnDps > 0) {
          s.burnAcc -= tick;
          damageEnemy(e, s.burnDps * tick, { color: 0xffaa44, intensity: 2.2, durationMs: 50 });

          if (_particlePool && Math.random() < 0.35) {
            _particlePool.burst({
              position: e.pos, color: 0xff8844, count: 3,
              speed: 2.5, lifetime: 0.25, size: 2, gravity: 0.2,
            });
          }
        }

        if (s.burnTime <= 0) {
          s.burnDps = 0;
          s.burnTick = 0.15;
          s.burnAcc = 0;
        }
      }
    }
  }

  if (_crates) {
    for (const c of _crates) {
      if (c.alive === false) continue;
      const s = ensureEnemyStatus(c);

      if (s.freeze > 0) s.freeze = Math.max(0, s.freeze - dt);
      if (s.stun > 0) s.stun = Math.max(0, s.stun - dt);

      if (s.slowTime > 0) {
        s.slowTime = Math.max(0, s.slowTime - dt);
        if (s.slowTime <= 0) s.slowMult = 1;
      }

      if (s.burnTime > 0 && s.burnDps > 0) {
        s.burnTime = Math.max(0, s.burnTime - dt);
        s.burnAcc += dt;
        const tick = Math.max(0.05, s.burnTick || 0.15);

        while (s.burnAcc >= tick && s.burnDps > 0) {
          s.burnAcc -= tick;
          damageCrate(c, s.burnDps * tick, { color: 0xffaa44, intensity: 1.9, durationMs: 60 });

          if (_particlePool && Math.random() < 0.25) {
            _particlePool.burst({
              position: c.pos, color: c.particleColor ?? 0xff8844, count: 2,
              speed: 2.2, lifetime: 0.2, size: 2, gravity: 0.15,
            });
          }
        }

        if (s.burnTime <= 0) {
          s.burnDps = 0;
          s.burnTick = 0.15;
          s.burnAcc = 0;
        }
      }

      if (c.movable !== false) {
        const moveScale = s.freeze > 0 ? 0.2 : (s.slowTime > 0 ? THREE.MathUtils.clamp(s.slowMult ?? 1, 0, 1) : 1);
        c.vel.multiplyScalar(Math.max(0, 1 - 3.25 * dt));
        const home = c.originalPos.clone().sub(c.pos);
        c.vel.addScaledVector(home, (c.returnStrength ?? 2.8) * dt);
        c.pos.addScaledVector(c.vel, dt * moveScale);
        c.pos.y = c.originalPos.y;
        c.mesh.position.copy(c.pos);
      }

      refreshArenaPropVisualState(c);
    }
  }
}

// Status effect helpers now imported from statusEffects.js
const ensureEnemyStatus = ensureStatus;
const clearEnemyStatuses = (e) => clearStatus(ensureStatus(e));

function getArenaPropMeshes(c) {
  if (Array.isArray(c?.reactiveMeshes) && c.reactiveMeshes.length) return c.reactiveMeshes;
  if (c?.bodyMesh) return [c.bodyMesh];
  return [];
}

function captureArenaPropMaterialBase(c) {
  for (const mesh of getArenaPropMeshes(c)) {
    if (!mesh?.material?.emissive) continue;
    if (mesh.userData.baseArenaEmissiveHex == null) {
      mesh.userData.baseArenaEmissiveHex = mesh.material.emissive.getHex();
      mesh.userData.baseArenaEmissiveIntensity = mesh.material.emissiveIntensity ?? 0;
    }
  }
}

function setArenaPropEmissive(c, color, intensity) {
  captureArenaPropMaterialBase(c);
  for (const mesh of getArenaPropMeshes(c)) {
    if (!mesh?.material?.emissive) continue;
    mesh.material.emissive.set(color);
    mesh.material.emissiveIntensity = intensity;
  }
}

function restoreArenaPropBaseEmissive(c) {
  captureArenaPropMaterialBase(c);
  for (const mesh of getArenaPropMeshes(c)) {
    if (!mesh?.material?.emissive) continue;
    mesh.material.emissive.setHex(mesh.userData.baseArenaEmissiveHex ?? 0x000000);
    mesh.material.emissiveIntensity = mesh.userData.baseArenaEmissiveIntensity ?? 0;
  }
}

function refreshArenaPropVisualState(c) {
  if (!c || c.alive === false || c._hitFlashActive) return;
  const s = ensureEnemyStatus(c);
  let color = 0x000000;
  let intensity = 0;
  if (s.freeze > 0) {
    color = 0x77d8ff;
    intensity = 0.58;
  } else if (s.burnTime > 0 && s.burnDps > 0) {
    color = 0xff8a33;
    intensity = 0.42 + Math.sin(elapsed * 18) * 0.12;
  } else if (s.stun > 0) {
    color = 0xcfe6ff;
    intensity = 0.42;
  } else if (s.slowTime > 0) {
    color = 0x406ca8;
    intensity = 0.24;
  }
  if (color === 0x000000 && intensity === 0) {
    restoreArenaPropBaseEmissive(c);
    return;
  }
  setArenaPropEmissive(c, color, intensity);
}

function flashArenaPropHit(c, opts = {}) {
  const { color = 0xffcc88, intensity = 1.6, durationMs = 80 } = opts;
  c._hitFlashActive = true;
  setArenaPropEmissive(c, color, intensity);
  const durationSec = durationMs / 1000;
  const t0 = elapsed;
  cbs.push((dt, el) => {
    if (el - t0 >= durationSec) {
      c._hitFlashActive = false;
      if (c.hp > 0) refreshArenaPropVisualState(c);
      return false;
    }
  });
}

function setArenaPropOpacity(c, alpha) {
  for (const mesh of c.fadeMeshes || getArenaPropMeshes(c)) {
    if (!mesh?.material) continue;
    mesh.material.transparent = alpha < 1;
    mesh.material.opacity = alpha;
  }
}

function applyArenaPropForce(c, force = {}) {
  if (!c || c.alive === false || c.movable === false) return c?.vel?.clone?.() || new THREE.Vector3();
  const scale = c.forceResponse ?? 0.12;
  c.vel.x += (force.x || 0) * scale;
  c.vel.y += (force.y || 0) * scale * 0.35;
  c.vel.z += (force.z || 0) * scale;
  return c.vel.clone();
}

function setArenaPropVelocity(c, velocity = {}) {
  if (!c?.vel) return new THREE.Vector3();
  if (c.movable === false) {
    c.vel.set(0, 0, 0);
    return c.vel.clone();
  }
  c.vel.set(velocity.x || 0, velocity.y || 0, velocity.z || 0);
  return c.vel.clone();
}

function dampArenaPropVelocity(c, multiplier = 0.8, opts = {}) {
  if (!c?.vel) return new THREE.Vector3();
  const m = THREE.MathUtils.clamp(multiplier, 0, 1);
  c.vel.x *= m;
  if (opts.includeY) c.vel.y *= m;
  c.vel.z *= m;
  return c.vel.clone();
}

function flashEnemyHit(e, opts = {}) {
  const { color = 0xffffff, intensity = 1.9, durationMs = 80 } = opts;
  e.bodyMesh.material.emissive.set(color);
  e.bodyMesh.material.emissiveIntensity = intensity;
  const durationSec = durationMs / 1000;
  const t0 = elapsed;
  cbs.push((dt, el) => {
    if (el - t0 >= durationSec) {
      if (e.hp > 0) {
        e.bodyMesh.material.emissive.set(0);
        e.bodyMesh.material.emissiveIntensity = 0;
      }
      return false;
    }
  });
}

function damageEnemy(e, amt, flashOpts = {}) {
  if (!Number.isFinite(amt) || amt <= 0) return;
  if (e.alive === false) return;
  // Enemy resistance check (from identity or arena god modifier)
  const weaponLower = getActiveWeaponName().toLowerCase();
  const resistance = e.identity?.resistance || e.resistType;
  if (resistance && weaponLower.includes(resistance)) {
    amt *= 0.5;
  }
  e.hp -= amt;
  playHit();
  flashEnemyHit(e, flashOpts);

  // Floating damage number
  if (_camera) {
    const screenPos = e.pos.clone().project(_camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    showDamageNumber(x, y, amt, '#ffcc00');
  }

  if (e.hp <= 0) {
    playEnemyDeath();
    GameState.addScore(e.typeConfig?.scoreValue || 100);
    updateKills(GameState.kills);
    updateScore(GameState.score);
    deathEffect(e.pos.clone());
    respawn(e);
  }
}

// ── Scorch mark helper ──
function addScorchMark(position, radius) {
  const size = radius * 0.6;
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(size, 16),
    new THREE.MeshStandardMaterial({
      color: 0x111111, roughness: 1, metalness: 0,
      transparent: true, opacity: 0.5, depthWrite: false,
    })
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.set(position.x, 0.03, position.z);
  _scene.add(scorch);
  visuals.push(scorch);
  const t0 = elapsed;
  cbs.push((dt, el) => {
    const age = el - t0;
    scorch.material.opacity = Math.max(0, 0.5 * (1 - age / 8));
    if (age > 8) {
      _scene.remove(scorch);
      try { scorch.geometry.dispose(); scorch.material.dispose(); } catch (x) {}
      const idx = visuals.indexOf(scorch); if (idx !== -1) visuals.splice(idx, 1);
      return false;
    }
  });
}

// ── Respawn enemy ──
function respawn(e) {
  e.alive = false;
  e.mesh.visible = false;
  e.vel.set(0, 0, 0);
  GameState.addKill();
  MatchMemory.recordEnemyKill(e);

  // Show last words
  if (e.identity?.lastWords && _camera) {
    const screenPos = e.pos.clone().add(new THREE.Vector3(0, 2, 0)).project(_camera);
    const lw = document.createElement('div');
    lw.className = 'enemy-last-words';
    lw.textContent = `"${e.identity.lastWords}"`;
    lw.style.left = ((screenPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    lw.style.top = ((-screenPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    document.body.appendChild(lw);
    setTimeout(() => lw.remove(), 2500);
  }

  // Rage buff on nearby allies
  if (e.identity) {
    for (const other of _enemies) {
      if (other === e || !other.alive) continue;
      const d = Math.hypot(other.pos.x - e.pos.x, other.pos.z - e.pos.z);
      if (d < 12) {
        other.bodyMesh.material.emissive.set(0xff0000);
        other.bodyMesh.material.emissiveIntensity = 2.5;
        setTimeout(() => {
          if (other.alive) {
            other.bodyMesh.material.emissive.set(0x000000);
            other.bodyMesh.material.emissiveIntensity = 0;
          }
        }, 300);
      }
    }
  }
}

// ── Death effect ──
function deathEffect(pos) {
  if (_effects.triggerSlowMo) _effects.triggerSlowMo(0.35, 0.12);
  if (_effects.triggerFlash) _effects.triggerFlash(0.25);
  addScorchMark(pos, 3);

  // Use particle pool instead of individual meshes
  _particlePool.burst({
    position: pos, color: 0xff6644, count: 25,
    speed: 12, lifetime: 1.0, size: 5, gravity: 1.2,
  });
  _particlePool.burst({
    position: pos, color: 0xffaa44, count: 15,
    speed: 8, lifetime: 0.7, size: 3, gravity: 0.8,
  });

  // Central flash light (just one light, no mesh particles)
  const fl = new THREE.PointLight(0xff6600, 4.5, 14);
  fl.position.copy(pos);
  _scene.add(fl);
  activeLights.push(fl);
  const flt0 = elapsed;
  cbs.push((dt, el) => {
    const a = el - flt0;
    fl.intensity = Math.max(0, 4.5 * (1 - a / 0.35));
    if (a > 0.35) {
      _scene.remove(fl);
      const idx = activeLights.indexOf(fl); if (idx !== -1) activeLights.splice(idx, 1);
      return false;
    }
  });
}

// ── Destructible Crate Damage ──
function damageCrate(c, amt, flashOpts = {}) {
  if (!Number.isFinite(amt) || amt <= 0) return;
  if (c.alive === false) return;
  c.hp -= amt;
  playHit();
  flashArenaPropHit(c, {
    color: c.kind === 'wall' ? 0xaec4ff : 0xffcc88,
    intensity: c.kind === 'wall' ? 1.35 : 1.6,
    durationMs: c.kind === 'wall' ? 90 : 80,
    ...flashOpts,
  });

  if (_camera) {
    const screenPos = c.pos.clone().project(_camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    showDamageNumber(x, y, amt, c.kind === 'wall' ? '#9db8ff' : '#ddaa44');
  }

  if (c.hp <= 0) {
    crateDeathEffect(c);
    c.alive = false;
    c.vel?.set?.(0, 0, 0);
    c.mesh.visible = false;
    respawnCrateAfterDelay(c);
  }
}

function crateDeathEffect(c) {
  const pos = c.pos.clone();
  const fragmentColor = c.fragmentColor ?? (c.kind === 'wall' ? 0x4c5d88 : 0x8B6914);
  const particleColor = c.particleColor ?? (c.kind === 'wall' ? 0x85a2ff : 0xbb8822);
  const fragmentCount = c.kind === 'wall' ? 11 : 8;
  for (let i = 0; i < fragmentCount; i++) {
    const size = c.kind === 'wall' ? (0.18 + Math.random() * 0.18) : (0.15 + Math.random() * 0.15);
    const frag = new THREE.Mesh(
      new THREE.BoxGeometry(size * (c.kind === 'wall' ? 1.6 : 1), size, size),
      new THREE.MeshStandardMaterial({ color: fragmentColor, flatShading: true })
    );
    const speed = 4 + Math.random() * 6;
    const angle = Math.random() * Math.PI * 2;
    const vy = 3 + Math.random() * 5;
    const vel = new THREE.Vector3(Math.cos(angle) * speed, vy, Math.sin(angle) * speed);
    entities.push({
      mesh: frag, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, Math.random() * 0.6, (Math.random() - 0.5) * 0.7)),
      vel, angVel: { x: (Math.random() - 0.5) * 10, y: (Math.random() - 0.5) * 10, z: (Math.random() - 0.5) * 10 },
      gravity: 1, radius: size * 0.5, bounce: 0.25, lifetime: 2, age: 0, onUpdate: null, alive: true,
      destroy() { destroyEntity(this); }, getPosition() { return this.pos.clone(); },
      getVelocity() { return this.vel.clone(); }, setVelocity(v) { this.vel.set(v.x||0, v.y||0, v.z||0); },
    });
    frag.position.copy(pos);
    _scene.add(frag);
  }

  _particlePool.burst({
    position: pos,
    color: particleColor,
    count: c.kind === 'wall' ? 12 : 10,
    speed: c.kind === 'wall' ? 5.5 : 6,
    lifetime: 0.6,
    size: c.kind === 'wall' ? 3.4 : 3,
    gravity: 0.8,
  });

  const lightColor = c.kind === 'wall' ? 0x9ab3ff : 0xffaa44;
  const baseIntensity = c.kind === 'wall' ? 2.2 : 2.5;
  const fl = new THREE.PointLight(lightColor, baseIntensity, c.kind === 'wall' ? 9 : 8);
  fl.position.copy(pos);
  _scene.add(fl);
  activeLights.push(fl);
  const flt0 = elapsed;
  cbs.push((dt, el) => {
    const a = el - flt0;
    fl.intensity = Math.max(0, baseIntensity * (1 - a / 0.25));
    if (a > 0.25) { _scene.remove(fl); const idx = activeLights.indexOf(fl); if (idx !== -1) activeLights.splice(idx, 1); return false; }
  });

  addScorchMark(pos, c.kind === 'wall' ? 1.9 : 1.5);
}

function respawnCrateAfterDelay(c) {
  setTimeout(() => {
    c.hp = c.maxHp;
    c.alive = true;
    c.pos.copy(c.originalPos);
    c.vel?.set?.(0, 0, 0);
    c.mesh.position.copy(c.originalPos);
    c.mesh.visible = true;
    clearStatus(ensureEnemyStatus(c));
    setArenaPropOpacity(c, 0);
    const t0 = elapsed;
    cbs.push((dt, el) => {
      const age = el - t0;
      const alpha = Math.min(1, age / 0.5);
      setArenaPropOpacity(c, alpha);
      refreshArenaPropVisualState(c);
      if (alpha >= 1) return false;
    });
  }, c.respawnDelayMs ?? 12000);
}

// ── Build the context passed to AI weapon code ──
export function buildCtx() {
  const yaw = _playerYaw();
  const aimPoint = getPlayerAimPoint();
  const toVec3 = (v) => {
    if (v instanceof THREE.Vector3) return v.clone();
    return new THREE.Vector3(v?.x || 0, v?.y || 0, v?.z || 0);
  };
  const wrapEnemy = (e) => ({
    position: e.pos.clone(),
    mesh: e.mesh,
    hp: e.hp,
    velocity: e.vel.clone(),
    takeDamage: (amt) => damageEnemy(e, amt),
    // NO hidden multiplier — force directly adds to velocity
    applyForce: (f) => {
      e.vel.x += (f.x || 0);
      e.vel.y += (f.y || 0);
      e.vel.z += (f.z || 0);
    },
    setVelocity: (v) => {
      e.vel.x = v?.x || 0;
      e.vel.y = v?.y || 0;
      e.vel.z = v?.z || 0;
    },
    dampVelocity: (multiplier = 0.8, opts = {}) => {
      const m = THREE.MathUtils.clamp(multiplier, 0, 1);
      e.vel.x *= m;
      if (opts.includeY) e.vel.y *= m;
      e.vel.z *= m;
      return e.vel.clone();
    },
    freeze: (seconds = 0.75, opts = {}) => {
      const s = ensureEnemyStatus(e);
      s.freeze = Math.max(s.freeze, Math.max(0, seconds || 0));
      if (opts.zeroVelocity !== false) e.vel.set(0, 0, 0);
      return s.freeze;
    },
    stun: (seconds = 0.4) => {
      const s = ensureEnemyStatus(e);
      s.stun = Math.max(s.stun, Math.max(0, seconds || 0));
      return s.stun;
    },
    slow: (multiplier = 0.35, seconds = 1.2) => {
      const s = ensureEnemyStatus(e);
      const m = THREE.MathUtils.clamp(multiplier, 0, 1);
      s.slowMult = s.slowTime > 0 ? Math.min(s.slowMult, m) : m;
      s.slowTime = Math.max(s.slowTime, Math.max(0, seconds || 0));
      return { multiplier: s.slowMult, remaining: s.slowTime };
    },
    ignite: (opts = {}) => {
      const dps = Math.max(0, opts.dps ?? 8);
      const duration = Math.max(0, opts.duration ?? 1.2);
      const tick = Math.max(0.05, opts.tick ?? 0.15);
      const s = ensureEnemyStatus(e);
      s.burnDps = Math.max(s.burnDps, dps);
      s.burnTime = Math.max(s.burnTime, duration);
      s.burnTick = Math.min(s.burnTick || tick, tick);
      return { dps: s.burnDps, remaining: s.burnTime };
    },
    distanceTo: (point) => e.pos.distanceTo(toVec3(point)),
  });
  const wrapCrate = (c) => ({
    position: c.pos.clone(),
    mesh: c.mesh,
    hp: c.hp,
    isObject: true,
    kind: c.kind || 'crate',
    velocity: c.vel.clone(),
    takeDamage: (amt) => damageCrate(c, amt),
    applyForce: (f) => applyArenaPropForce(c, f),
    setVelocity: (v) => setArenaPropVelocity(c, v),
    dampVelocity: (multiplier = 0.8, opts = {}) => dampArenaPropVelocity(c, multiplier, opts),
    freeze: (seconds = 0.75, opts = {}) => {
      const s = ensureEnemyStatus(c);
      s.freeze = Math.max(s.freeze, Math.max(0, seconds || 0));
      if (opts.zeroVelocity !== false) c.vel.set(0, 0, 0);
      refreshArenaPropVisualState(c);
      return s.freeze;
    },
    stun: (seconds = 0.4) => {
      const s = ensureEnemyStatus(c);
      s.stun = Math.max(s.stun, Math.max(0, seconds || 0));
      refreshArenaPropVisualState(c);
      return s.stun;
    },
    slow: (multiplier = 0.35, seconds = 1.2) => {
      const s = ensureEnemyStatus(c);
      const m = THREE.MathUtils.clamp(multiplier, 0, 1);
      s.slowMult = s.slowTime > 0 ? Math.min(s.slowMult, m) : m;
      s.slowTime = Math.max(s.slowTime, Math.max(0, seconds || 0));
      refreshArenaPropVisualState(c);
      return { multiplier: s.slowMult, remaining: s.slowTime };
    },
    ignite: (opts = {}) => {
      const dps = Math.max(0, opts.dps ?? 8);
      const duration = Math.max(0, opts.duration ?? 1.2);
      const tick = Math.max(0.05, opts.tick ?? 0.15);
      const s = ensureEnemyStatus(c);
      s.burnDps = Math.max(s.burnDps, dps);
      s.burnTime = Math.max(s.burnTime, duration);
      s.burnTick = Math.min(s.burnTick || tick, tick);
      refreshArenaPropVisualState(c);
      return { dps: s.burnDps, remaining: s.burnTime };
    },
    distanceTo: (point) => c.pos.distanceTo(toVec3(point)),
  });

  const ctx = {
    THREE: THREE, scene: _scene,

    player: {
      getPosition: () => getPlayerShootOrigin(),
      getTorsoPosition: () => getPlayerTorsoOrigin(),
      getFeetPosition: () => _player.pos.clone(),
      getShootOrigin: () => getPlayerShootOrigin(),
      getAimPoint: () => aimPoint?.clone() ?? null,
      getDirection: () => getPlayerAimDirection(yaw),
      getFacingDirection: () => getPlayerFacingDirection(yaw),
      getRight: () => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
      getUp: () => new THREE.Vector3(0, 1, 0),
      getVelocity: () => _player.vel.clone(),
      getQuaternion: () => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    },

    getEnemies: () => {
      if (!_cachedEnemyWraps) {
        _cachedEnemyWraps = [
          ..._enemies.filter(e => e.alive).map(wrapEnemy),
          ..._crates.filter(c => c.alive).map(wrapCrate),
        ];
      }
      return _cachedEnemyWraps;
    },

    spawn: (mesh, opt = {}) => {
      const { position = new THREE.Vector3(), velocity = new THREE.Vector3(), angularVelocity = null,
        gravity = 1, radius = 0.5, bounce = 0.3, lifetime = null, onUpdate = null } = opt;
      const vel = velocity instanceof THREE.Vector3 ? velocity.clone() : new THREE.Vector3(velocity.x || 0, velocity.y || 0, velocity.z || 0);
      const pos = position instanceof THREE.Vector3 ? position.clone() : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);

      // Apply weapon visuals to spawned projectiles
      if (_activeWeaponVisuals?.projectile && mesh.material) {
        try {
          const pv = _activeWeaponVisuals.projectile;
          mesh.material.color?.set(pv.color);
          if (mesh.material.emissive) {
            mesh.material.emissive.set(pv.emissiveColor || pv.color);
            mesh.material.emissiveIntensity = pv.glowIntensity || 1.5;
          }
        } catch (e) { /* ignore visual errors */ }
      }

      mesh.position.copy(pos);
      _scene.add(mesh);
      const ent = {
        mesh, pos, vel,
        angVel: angularVelocity ? { x: angularVelocity.x || 0, y: angularVelocity.y || 0, z: angularVelocity.z || 0 } : null,
        gravity, radius, bounce, lifetime, age: 0, onUpdate, alive: true,
        destroy() { destroyEntity(ent); },
        getPosition() { return pos.clone(); },
        getVelocity() { return vel.clone(); },
        setVelocity(v) { vel.x = v.x || 0; vel.y = v.y || 0; vel.z = v.z || 0; },
      };
      entities.push(ent);
      return ent;
    },

    addMesh: (m) => { _scene.add(m); visuals.push(m); return m; },
    removeMesh: (m) => {
      _scene.remove(m);
      try { if (m.geometry) m.geometry.dispose(); if (m.material) { if (Array.isArray(m.material)) m.material.forEach(x => x.dispose()); else m.material.dispose(); } } catch (x) {}
      const i = visuals.indexOf(m); if (i !== -1) visuals.splice(i, 1);
    },
    addLight: (l) => { _scene.add(l); activeLights.push(l); return l; },
    removeLight: (l) => { _scene.remove(l); const i = activeLights.indexOf(l); if (i !== -1) activeLights.splice(i, 1); },
    addObject: (o) => { _scene.add(o); visuals.push(o); return o; },
    onUpdate: (fn) => { cbs.push(fn); return fn; },
    removeOnUpdate: (fn) => { const i = cbs.indexOf(fn); if (i !== -1) cbs.splice(i, 1); },
    after: (s, fn) => { const t = { r: s, f: fn }; timers.push(t); return t; },
    every: (s, fn) => { const v = { p: s, r: s, f: fn, s: false }; intervals.push(v); return { stop() { v.s = true; } }; },
    destroy: destroyEntity,
    findEnemiesInCone: (origin, direction, opts = {}) => {
      const o = toVec3(origin);
      const dir = toVec3(direction);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const range = Math.max(0, opts.range ?? 12);
      const angleDeg = THREE.MathUtils.clamp(opts.angleDeg ?? 22, 0.1, 180);
      const cosThresh = Math.cos(THREE.MathUtils.degToRad(angleDeg));

      const inCone = (target) => {
        const toTarget = target.pos.clone().sub(o);
        const d = toTarget.length();
        if (d <= 0.0001 || d > range) return false;
        toTarget.normalize();
        return dir.dot(toTarget) >= cosThresh;
      };
      return [
        ..._enemies.filter(e => e.alive && inCone(e)).map(wrapEnemy),
        ..._crates.filter(c => c.alive && inCone(c)).map(wrapCrate),
      ];
    },
    applyRadialForce: (center, opts = {}) => {
      const c = toVec3(center);
      const radius = Math.max(0.001, opts.radius ?? 8);
      const strength = opts.strength ?? 10;
      const mode = opts.mode === 'inward' ? 'inward' : 'outward';
      const lift = opts.lift ?? 0;
      const falloffMode = opts.falloff === 'none' ? 'none' : 'linear';
      let affected = 0;

      for (const e of _enemies) {
        const delta = e.pos.clone().sub(c);
        const d = delta.length();
        if (d > radius) continue;

        let dir = mode === 'inward' ? c.clone().sub(e.pos) : delta;
        if (dir.lengthSq() < 1e-6) {
          dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
        }
        dir.normalize();

        const falloff = falloffMode === 'none' ? 1 : Math.max(0, 1 - d / radius);
        e.vel.x += dir.x * strength * falloff;
        e.vel.y += (dir.y * strength + lift) * falloff;
        e.vel.z += dir.z * strength * falloff;
        affected++;
      }

      for (const prop of _crates) {
        if (!prop.alive || prop.movable === false) continue;
        const delta = prop.pos.clone().sub(c);
        const d = delta.length();
        if (d > radius) continue;

        let dir = mode === 'inward' ? c.clone().sub(prop.pos) : delta;
        if (dir.lengthSq() < 1e-6) {
          dir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
        }
        dir.normalize();

        const falloff = falloffMode === 'none' ? 1 : Math.max(0, 1 - d / radius);
        applyArenaPropForce(prop, {
          x: dir.x * strength * falloff,
          y: (dir.y * strength + lift) * falloff,
          z: dir.z * strength * falloff,
        });
        affected++;
      }

      return affected;
    },
    // ── Trail Renderer ──
    createTrail: (opts = {}) => {
      const t = new Trail(_scene, opts);
      trails.push(t);
      return t;
    },

    // ── GPU Particle Burst (single draw call) ──
    burstParticles: (opts = {}) => {
      if (_particlePool) {
        // Apply weapon visuals color if no explicit color set
        if (!opts.color && _activeWeaponVisuals?.impact) {
          opts.color = _activeWeaponVisuals.impact.particleColor;
        }
        _particlePool.burst(opts);
      }
    },

    // ── Explosion Helper (now uses particle pool) ──
    explode: (position, opts = {}) => {
      const { radius = 5, damage = 30, force = 15, color = 0xff6600, particles = 15, lightIntensity = 3.8 } = opts;
      const p = position instanceof THREE.Vector3 ? position : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);

      if (_effects.triggerFlash) _effects.triggerFlash(0.12);
      addScorchMark(p, radius);

      // Damage + push enemies
      for (const e of _enemies) {
        const d = e.pos.distanceTo(p);
        if (d < radius) {
          const falloff = 1 - d / radius;
          const dir = e.pos.clone().sub(p).normalize();
          e.vel.add(dir.multiplyScalar(force * falloff));
          damageEnemy(e, damage * falloff);
        }
      }
      // Damage crates
      for (const c of _crates) {
        if (!c.alive) continue;
        const d = c.pos.distanceTo(p);
        if (d < radius) {
          const falloff = 1 - d / radius;
          if (c.movable !== false) {
            const dir = c.pos.clone().sub(p).normalize();
            applyArenaPropForce(c, dir.multiplyScalar(force * falloff));
          }
          damageCrate(c, damage * falloff);
        }
      }

      // Light flash (single light)
      const fl = new THREE.PointLight(color, lightIntensity, radius * 2.5);
      fl.position.copy(p); _scene.add(fl); activeLights.push(fl);
      const flt0 = elapsed;
      cbs.push((dt, el) => {
        const a = el - flt0;
        fl.intensity = Math.max(0, lightIntensity * (1 - a / 0.25));
        if (a > 0.25) { _scene.remove(fl); const idx = activeLights.indexOf(fl); if (idx !== -1) activeLights.splice(idx, 1); return false; }
      });

      // Particles via pool — ONE draw call, no mesh spam
      _particlePool.burst({
        position: p, color, count: particles,
        speed: 10, lifetime: 0.7, size: 4, gravity: 1,
      });
      // Secondary darker smoke burst
      _particlePool.burst({
        position: p, color: 0x443322, count: Math.floor(particles * 0.5),
        speed: 5, lifetime: 1.0, size: 6, gravity: 0.3,
      });

      // Shockwave ring (single mesh, very cheap)
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.1, 0.5, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
      );
      ring.position.copy(p); ring.position.y += 0.1; ring.rotation.x = -Math.PI / 2;
      _scene.add(ring); visuals.push(ring);
      const rt0 = elapsed;
      cbs.push((dt2, el2) => {
        const age = el2 - rt0;
        ring.scale.setScalar(1 + age / 0.35 * radius);
        ring.material.opacity = Math.max(0, 0.7 * (1 - age / 0.35));
        if (age > 0.35) {
          _scene.remove(ring);
          try { ring.geometry.dispose(); ring.material.dispose(); } catch (x) {}
          const idx = visuals.indexOf(ring); if (idx !== -1) visuals.splice(idx, 1);
          return false;
        }
      });

      shakeAmt = Math.min(1.2, radius * 0.12);
      shakeTime = 0.2;
    },

    raycast: (o, d, mx = 100) => {
      const origin = o instanceof THREE.Vector3 ? o : new THREE.Vector3(o.x, o.y, o.z);
      const dir = d instanceof THREE.Vector3 ? d.clone().normalize() : new THREE.Vector3(d.x, d.y, d.z).normalize();
      if (dir.y < -0.001) { const t = -origin.y / dir.y; if (t > 0 && t < mx) return { point: origin.clone().add(dir.clone().multiplyScalar(t)), distance: t }; }
      return { point: origin.clone().add(dir.clone().multiplyScalar(mx)), distance: mx };
    },

    get elapsed() { return elapsed; },
    shake: (i = 0.5, d = 0.2) => { shakeAmt = i; shakeTime = d; },
  };

  const sdk = createWeaponSdk({
    THREE: THREE,
    scene: _scene,
    toVec3,
    getEnemies: () => ctx.getEnemies(),
    onUpdate: (fn) => ctx.onUpdate(fn),
    removeOnUpdate: (fn) => ctx.removeOnUpdate(fn),
    addMesh: (m) => ctx.addMesh(m),
    removeMesh: (m) => ctx.removeMesh(m),
    addObject: (o) => ctx.addObject(o),
    burstParticles: (opts) => ctx.burstParticles(opts),
    addLight: (l) => ctx.addLight(l),
    removeLight: (l) => ctx.removeLight(l),
    baseFindEnemiesInCone: (origin, direction, opts) => ctx.findEnemiesInCone(origin, direction, opts),
    applyRadialForce: (center, opts) => ctx.applyRadialForce(center, opts),
  });

  ctx.sdk = sdk;
  for (const [name, helper] of Object.entries(sdk)) {
    if (!(name in ctx)) ctx[name] = helper;
  }

  return ctx;
}

// ── Frame tick (call once per frame from game loop) ──
export function tickFrame() { _frameCounter++; _cachedEnemyWraps = null; }

// ── Fire weapon ──
export function fire() {
  if (!fireFn) return;
  if (elapsed - lastFire < 0.05) return;
  lastFire = elapsed;
  if (_ctxFrame !== _frameCounter) {
    _cachedCtx = createSafeContext(buildCtx());
    _ctxFrame = _frameCounter;
  }
  try { fireFn(_cachedCtx); } catch (e) { console.error('Weapon error:', e); }
}

// ── Set current weapon ──
export function setWeapon(fn, name, code, slot) {
  resetSandbox();
  const targetSlot = slot ?? getNextEmptySlot();
  weaponSlots[targetSlot] = { fn, name, code: code || '' };
  activeSlot = targetSlot;
  fireFn = fn;
  updateWeaponSlotsHud();
  document.getElementById('weapon-name').textContent = name || '';
  saveWeapons(weaponSlots);
}

export function switchWeapon(slot) {
  if (slot < 0 || slot >= 4) return;
  if (!weaponSlots[slot].fn) return;
  activeSlot = slot;
  fireFn = weaponSlots[slot].fn;
  updateWeaponSlotsHud();
  document.getElementById('weapon-name').textContent = weaponSlots[slot].name || '';
}

export function getNextEmptySlot() {
  const empty = weaponSlots.findIndex(s => !s.fn);
  return empty >= 0 ? empty : activeSlot;
}

export function getActiveSlot() { return activeSlot; }
export function getWeaponSlots() { return weaponSlots; }
export function getActiveWeaponName() { return weaponSlots[activeSlot]?.name || ''; }

function updateWeaponSlotsHud() {
  document.querySelectorAll('.weapon-slot').forEach((el, i) => {
    const w = weaponSlots[i];
    const nameEl = el.querySelector('.slot-name');
    if (nameEl) nameEl.textContent = w.fn ? w.name : 'Empty';
    el.classList.toggle('active', i === activeSlot);
    el.classList.toggle('occupied', !!w.fn);
  });
}

// ── Load saved weapons from localStorage ──
export function loadSavedWeapons() {
  try {
    const saved = loadWeapons();
    if (!saved || saved.length === 0) return;
    for (const entry of saved) {
      if (!entry || !entry.code) continue;
      const idx = typeof entry.slotIndex === 'number' ? entry.slotIndex : 0;
      if (idx < 0 || idx >= weaponSlots.length) continue;
      try {
        const validation = validateWeaponCode(entry.code);
        if (!validation.valid) {
          console.warn(`Saved weapon in slot ${idx} failed validation:`, validation.errors);
          continue;
        }
        const fn = new Function('ctx', entry.code);
        weaponSlots[idx] = { fn, name: entry.prompt || 'Weapon', code: entry.code };
      } catch (err) {
        console.warn(`Failed to compile saved weapon in slot ${idx}:`, err);
      }
    }
    const firstOccupied = weaponSlots.findIndex(s => s && s.fn);
    if (firstOccupied !== -1) {
      activeSlot = firstOccupied;
      fireFn = weaponSlots[firstOccupied].fn;
      document.getElementById('weapon-name').textContent = weaponSlots[firstOccupied].name;
    }
    updateWeaponSlotsHud();
  } catch (err) {
    console.warn('Failed to load saved weapons:', err);
  }
}

// ── Full cleanup ──
export function resetSandbox() {
  [...entities].forEach(destroyEntity); entities.length = 0;
  visuals.forEach(m => {
    _scene.remove(m);
    try { if (m.geometry) m.geometry.dispose(); if (m.material) { if (Array.isArray(m.material)) m.material.forEach(x => x.dispose()); else m.material.dispose(); } } catch (x) {}
  });
  visuals.length = 0;
  activeLights.forEach(l => _scene.remove(l)); activeLights.length = 0;
  trails.forEach(t => t.destroy()); trails.length = 0;
  if (_enemies) {
    for (const e of _enemies) {
      clearEnemyStatuses(e);
      e.vel.set(0, 0, 0);
      if (e.pos.y < 0.6) e.pos.y = 0.6;
    }
  }
  if (_crates) {
    for (const c of _crates) {
      clearStatus(ensureEnemyStatus(c));
      c.vel?.set?.(0, 0, 0);
      if (c.pos && c.originalPos) c.pos.copy(c.originalPos);
      if (c.mesh && c.originalPos) c.mesh.position.copy(c.originalPos);
      refreshArenaPropVisualState(c);
    }
  }
  cbs.length = 0; timers.length = 0; intervals.length = 0;
  fireFn = null;
}



