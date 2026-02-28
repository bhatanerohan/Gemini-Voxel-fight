import * as THREE from 'three';
import { Trail } from './trail.js';
import { ParticlePool } from './particles.js';
import { createWeaponSdk } from './weaponSdk/index.js';
import { createSafeContext } from './weaponValidator.js';
import { saveWeapons, loadWeapons } from './weaponStorage.js';
import { GameState } from './gameState.js';
import { updateScore, updateKills, showDamageNumber } from './hud.js';
import { playHit, playEnemyDeath } from './audio.js';

GameState.on('wave_clear', ({ wave }) => {
  const bonus = wave * 100;
  GameState.addScore(bonus);
  updateScore(GameState.score);
});

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

const weaponSlots = [
  { fn: null, name: '' },
  { fn: null, name: '' },
  { fn: null, name: '' },
  { fn: null, name: '' },
];
let activeSlot = 0;
export let shakeAmt = 0;
export let shakeTime = 0;
const PLAYER_TORSO_ORIGIN_Y = 0.95;

// References set by main.js
let _scene, _camera, _enemies, _player, _playerYaw;
let _getAimPoint = null;
let _effects = {};
let _particlePool = null;
let _compatThree = null;

function getCompatThree() {
  if (_compatThree) return _compatThree;

  const compat = { ...THREE };
  if (typeof compat.CapsuleGeometry !== 'function') {
    // Three r128 may not expose CapsuleGeometry; provide a safe fallback.
    compat.CapsuleGeometry = class CapsuleGeometry extends THREE.CylinderGeometry {
      constructor(radius = 0.25, length = 1, capSegments = 8, radialSegments = 8) {
        const r = Math.max(0.01, Number.isFinite(radius) ? radius : 0.25);
        const body = Math.max(0.001, Number.isFinite(length) ? length : 1);
        const radial = Math.max(3, Math.floor(Number.isFinite(radialSegments) ? radialSegments : 8));
        const radialCap = Math.max(1, Math.floor(Number.isFinite(capSegments) ? capSegments : 8));

        // Approximation: cylinder height includes hemispherical cap space.
        super(r, r, body + r * 2, radial, radialCap, false);
      }
    };
  }

  _compatThree = compat;
  return _compatThree;
}

export function initSandbox(scene, camera, player, enemies, getYaw, getAimPoint, effects = {}) {
  _scene = scene;
  _camera = camera;
  _player = player;
  _enemies = enemies;
  _playerYaw = getYaw;
  _getAimPoint = typeof getAimPoint === 'function' ? getAimPoint : null;
  _effects = effects;
  _particlePool = new ParticlePool(scene, 800);
}

function getPlayerAimPoint() {
  if (typeof _getAimPoint !== 'function') return null;
  const point = _getAimPoint();
  if (!point) return null;
  if (point instanceof THREE.Vector3) return point.clone();
  return new THREE.Vector3(point.x ?? 0, point.y ?? 0, point.z ?? 0);
}

function getPlayerFacingDirection(yaw) {
  return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
}

export function setShake(amt, time) {
  shakeAmt = amt;
  shakeTime = time;
}

export function getShake() {
  return { amt: shakeAmt, time: shakeTime };
}

function getPlayerTorsoOrigin() {
  return _player.pos.clone().add(new THREE.Vector3(0, PLAYER_TORSO_ORIGIN_Y, 0));
}

function getPlayerShootOrigin() {
  const muzzleTip = _player?.mesh?.userData?.rig?.muzzleTip;
  if (muzzleTip && typeof muzzleTip.getWorldPosition === 'function') {
    return muzzleTip.getWorldPosition(new THREE.Vector3());
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
}

function ensureEnemyStatus(e) {
  if (!e.status) {
    e.status = {};
  }
  if (typeof e.status.freeze !== 'number') e.status.freeze = 0;
  if (typeof e.status.stun !== 'number') e.status.stun = 0;
  if (typeof e.status.slowMult !== 'number') e.status.slowMult = 1;
  if (typeof e.status.slowTime !== 'number') e.status.slowTime = 0;
  if (typeof e.status.burnDps !== 'number') e.status.burnDps = 0;
  if (typeof e.status.burnTime !== 'number') e.status.burnTime = 0;
  if (typeof e.status.burnTick !== 'number') e.status.burnTick = 0.15;
  if (typeof e.status.burnAcc !== 'number') e.status.burnAcc = 0;
  return e.status;
}

function clearEnemyStatuses(e) {
  const s = ensureEnemyStatus(e);
  s.freeze = 0;
  s.stun = 0;
  s.slowMult = 1;
  s.slowTime = 0;
  s.burnDps = 0;
  s.burnTime = 0;
  s.burnTick = 0.15;
  s.burnAcc = 0;
  return s;
}

function flashEnemyHit(e, opts = {}) {
  const { color = 0xffffff, intensity = 1.9, durationMs = 80 } = opts;
  e.bodyMesh.material.emissive.set(color);
  e.bodyMesh.material.emissiveIntensity = intensity;
  setTimeout(() => {
    if (e.hp > 0) {
      e.bodyMesh.material.emissive.set(0);
      e.bodyMesh.material.emissiveIntensity = 0;
    }
  }, durationMs);
}

function damageEnemy(e, amt, flashOpts = {}) {
  if (!Number.isFinite(amt) || amt <= 0) return;
  if (e.alive === false) return;
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
    GameState.addScore(100);
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

// ── Build the context passed to AI weapon code ──
export function buildCtx() {
  const compatTHREE = getCompatThree();
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

  const ctx = {
    THREE: compatTHREE, scene: _scene,

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

    getEnemies: () => _enemies.map(wrapEnemy),

    spawn: (mesh, opt = {}) => {
      const { position = new THREE.Vector3(), velocity = new THREE.Vector3(), angularVelocity = null,
        gravity = 1, radius = 0.5, bounce = 0.3, lifetime = null, onUpdate = null } = opt;
      const vel = velocity instanceof THREE.Vector3 ? velocity.clone() : new THREE.Vector3(velocity.x || 0, velocity.y || 0, velocity.z || 0);
      const pos = position instanceof THREE.Vector3 ? position.clone() : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);
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

      return _enemies
        .filter((e) => {
          const toEnemy = e.pos.clone().sub(o);
          const d = toEnemy.length();
          if (d <= 0.0001 || d > range) return false;
          toEnemy.normalize();
          return dir.dot(toEnemy) >= cosThresh;
        })
        .map(wrapEnemy);
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
      if (_particlePool) _particlePool.burst(opts);
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
    THREE: compatTHREE,
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

// ── Fire weapon ──
export function fire() {
  if (!fireFn) return;
  if (elapsed - lastFire < 0.05) return;
  lastFire = elapsed;
  try { fireFn(createSafeContext(buildCtx())); } catch (e) { console.error('Weapon error:', e); }
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
  cbs.length = 0; timers.length = 0; intervals.length = 0;
  fireFn = null;
}



