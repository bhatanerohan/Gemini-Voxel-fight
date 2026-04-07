import * as THREE from 'three';
import { Trail } from './trail.js';
import { ParticlePool } from './particles.js';
import { createWeaponSdk } from './weaponSdk/index.js';
import {
  DEFAULT_WEAPON_FIRE_MODE,
  getWeaponFireProfile,
  sanitizeWeaponFireMode as sanitizeWeaponFireModeValue,
  sanitizeWeaponTier as sanitizeWeaponBalanceTier,
} from './weaponBalance.js';

// Ã¢â€â‚¬Ã¢â€â‚¬ Tracked state Ã¢â€â‚¬Ã¢â€â‚¬
export const entities = [];
export const visuals = [];
export const activeLights = [];
export const trails = [];
export const cbs = [];
export const timers = [];
export const intervals = [];

export let elapsed = 0;
export const weaponSlots = new Map();
export let shakeAmt = 0;
export let shakeTime = 0;
const PLAYER_TORSO_ORIGIN_Y = 0.95;
const TRAIL_FALLBACK_POINT = new THREE.Vector3();
const queuedDeathEffects = [];
const activeScorchMarks = [];
const scorchMarkPool = [];
const activeShockwaveRings = [];
const shockwaveRingPool = [];
const activeFlashLights = [];
const flashLightPool = [];
const SHARED_SCORCH_GEOMETRY = new THREE.CircleGeometry(1, 16);
const SHARED_RING_GEOMETRY = new THREE.RingGeometry(0.1, 0.5, 24);
const DEATH_EFFECT_STAGGER = 1 / 60;
const MAX_DEATH_EFFECTS_PER_TICK = 2;
export const WEAPON_LOADOUT_SIZE = 4;
export const DEFAULT_WEAPON_COOLDOWN_MS = 650;
let _localPlayerId = 'local';

// References set by main.js
let _scene, _camera, _enemies, _player, _playerYaw;
let _getAimPoint = null;
let _effects = {};
let _particlePool = null;
let _compatThree = null;
const _worldRaycaster = new THREE.Raycaster();

function getTrackedCombatants() {
  if (typeof _enemies === 'function') {
    try {
      const combatants = _enemies();
      return Array.isArray(combatants) ? combatants : [];
    } catch (err) {
      console.error(err);
      return [];
    }
  }
  return Array.isArray(_enemies) ? _enemies : [];
}

function canMutateEnemies() {
  if (typeof _effects?.canMutateEnemies === 'function') {
    try {
      return _effects.canMutateEnemies() !== false;
    } catch (err) {
      console.error(err);
      return true;
    }
  }
  return true;
}

function getCombatantId(combatant) {
  return combatant?.playerId || combatant?.id || null;
}

function getCombatantTeamId(combatant) {
  return combatant?.teamId || combatant?.team || null;
}

function isCombatantAlive(combatant) {
  return Boolean(combatant) && (combatant.hp ?? 0) > 0;
}

function getCombatantById(playerId) {
  if (!playerId) return null;
  return getTrackedCombatants().find((combatant) => getCombatantId(combatant) === playerId) || null;
}

function getOpposingCombatants(actor) {
  const combatants = getTrackedCombatants();
  if (!combatants.length) return [];
  const actorId = actor?.id || actor?.playerId || _localPlayerId;
  const actorCombatant = getCombatantById(actorId);
  const actorTeamId = actor?.teamId || getCombatantTeamId(actorCombatant);
  return combatants.filter((combatant) => (
    isCombatantAlive(combatant)
    && getCombatantId(combatant) !== actorId
    && (!actorTeamId || !getCombatantTeamId(combatant) || getCombatantTeamId(combatant) !== actorTeamId)
  ));
}

function getWorldCollisionMeshes() {
  const meshes = _scene?.userData?.weaponCollisionMeshes;
  return Array.isArray(meshes) ? meshes : [];
}

function getGraphicsSettings() {
  return _scene?.userData?.graphicsSettings ?? null;
}

function getMaxWeaponLights() {
  const maxLights = getGraphicsSettings()?.maxWeaponLights;
  return Number.isFinite(maxLights) ? Math.max(0, Math.floor(maxLights)) : 6;
}

function getActivePointLightCount() {
  let count = 0;
  for (const light of activeLights) {
    if (light?.isPointLight) count++;
  }
  return count;
}

function addManagedLight(light) {
  if (!light) return null;
  if (light.isPointLight && getActivePointLightCount() >= getMaxWeaponLights()) {
    return null;
  }
  _scene.add(light);
  activeLights.push(light);
  return light;
}

function removeManagedLight(light) {
  if (!light) return;
  _scene.remove(light);
  const i = activeLights.indexOf(light);
  if (i !== -1) activeLights.splice(i, 1);
}

function createScorchMarkEntry() {
  const mesh = new THREE.Mesh(
    SHARED_SCORCH_GEOMETRY,
    new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return {
    mesh,
    startTime: 0,
    duration: 8,
    maxOpacity: 0.5,
  };
}

function acquireScorchMark() {
  return scorchMarkPool.pop() || createScorchMarkEntry();
}

function releaseScorchMark(entry) {
  if (!entry) return;
  entry.mesh.visible = false;
  if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
  scorchMarkPool.push(entry);
}

function createShockwaveRingEntry() {
  const mesh = new THREE.Mesh(
    SHARED_RING_GEOMETRY,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return {
    mesh,
    startTime: 0,
    duration: 0.35,
    radius: 5,
    maxOpacity: 0.7,
  };
}

function acquireShockwaveRing() {
  return shockwaveRingPool.pop() || createShockwaveRingEntry();
}

function releaseShockwaveRing(entry) {
  if (!entry) return;
  entry.mesh.visible = false;
  if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
  shockwaveRingPool.push(entry);
}

function acquireFlashLight() {
  return flashLightPool.pop() || new THREE.PointLight(0xff6600, 1, 8);
}

function releaseFlashLightEntry(entry) {
  if (!entry?.light) return;
  removeManagedLight(entry.light);
  flashLightPool.push(entry.light);
}

function updatePooledTransientEffects() {
  for (let i = activeScorchMarks.length - 1; i >= 0; i--) {
    const entry = activeScorchMarks[i];
    const age = elapsed - entry.startTime;
    if (age >= entry.duration) {
      activeScorchMarks.splice(i, 1);
      releaseScorchMark(entry);
      continue;
    }
    entry.mesh.material.opacity = Math.max(0, entry.maxOpacity * (1 - age / entry.duration));
  }

  for (let i = activeShockwaveRings.length - 1; i >= 0; i--) {
    const entry = activeShockwaveRings[i];
    const age = elapsed - entry.startTime;
    if (age >= entry.duration) {
      activeShockwaveRings.splice(i, 1);
      releaseShockwaveRing(entry);
      continue;
    }
    const progress = age / entry.duration;
    entry.mesh.scale.setScalar(1 + progress * entry.radius);
    entry.mesh.material.opacity = Math.max(0, entry.maxOpacity * (1 - progress));
  }

  for (let i = activeFlashLights.length - 1; i >= 0; i--) {
    const entry = activeFlashLights[i];
    const age = elapsed - entry.startTime;
    if (age >= entry.duration) {
      activeFlashLights.splice(i, 1);
      releaseFlashLightEntry(entry);
      continue;
    }
    entry.light.intensity = Math.max(0, entry.startIntensity * (1 - age / entry.duration));
  }

  let processed = 0;
  while (queuedDeathEffects.length > 0 && processed < MAX_DEATH_EFFECTS_PER_TICK) {
    if (queuedDeathEffects[0].scheduledAt > elapsed + 1e-6) break;
    const effect = queuedDeathEffects.shift();
    playDeathEffect(effect.position);
    processed++;
  }
}

function resetPooledTransientEffects() {
  queuedDeathEffects.length = 0;

  for (let i = activeScorchMarks.length - 1; i >= 0; i--) {
    releaseScorchMark(activeScorchMarks[i]);
  }
  activeScorchMarks.length = 0;

  for (let i = activeShockwaveRings.length - 1; i >= 0; i--) {
    releaseShockwaveRing(activeShockwaveRings[i]);
  }
  activeShockwaveRings.length = 0;

  for (let i = activeFlashLights.length - 1; i >= 0; i--) {
    releaseFlashLightEntry(activeFlashLights[i]);
  }
  activeFlashLights.length = 0;
}

function computeHitNormal(hit, fallbackDir = null) {
  if (hit?.face?.normal && hit?.object?.matrixWorld) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
  }
  if (fallbackDir && fallbackDir.lengthSq() > 1e-6) {
    return fallbackDir.clone().multiplyScalar(-1).normalize();
  }
  return new THREE.Vector3(0, 1, 0);
}

function raycastWorld(origin, direction, maxDistance = 100) {
  const meshes = getWorldCollisionMeshes();
  const dir = direction instanceof THREE.Vector3
    ? direction.clone()
    : new THREE.Vector3(direction?.x || 0, direction?.y || 0, direction?.z || 0);
  if (dir.lengthSq() <= 1e-8 || meshes.length === 0) return null;

  dir.normalize();
  _worldRaycaster.set(origin, dir);
  _worldRaycaster.far = maxDistance;
  const hits = _worldRaycaster.intersectObjects(meshes, false);
  if (!hits.length) return null;

  const hit = hits[0];
  return {
    ...hit,
    normal: computeHitNormal(hit, dir),
  };
}

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

export function setLocalPlayerId(playerId) {
  _localPlayerId = playerId || 'local';
  updateLocalWeaponLabel();
}

function clampSlotIndex(slotIndex) {
  const numeric = Number(slotIndex);
  if (!Number.isFinite(numeric)) return null;
  const resolved = Math.max(0, Math.min(WEAPON_LOADOUT_SIZE - 1, Math.floor(numeric)));
  return resolved;
}

function sanitizeCooldownMs(cooldownMs) {
  const numeric = Number(cooldownMs);
  if (!Number.isFinite(numeric)) return DEFAULT_WEAPON_COOLDOWN_MS;
  return Math.max(50, Math.min(60000, Math.round(numeric)));
}

function sanitizeWeaponTier(tier) {
  return sanitizeWeaponBalanceTier(tier, null);
}

function sanitizeWeaponFireMode(fireMode) {
  return sanitizeWeaponFireModeValue(fireMode, DEFAULT_WEAPON_FIRE_MODE);
}

function resetWeaponSlotTiming(slot) {
  slot.lastFiredAt = Number.NEGATIVE_INFINITY;
  slot.channelStartedAt = Number.NEGATIVE_INFINITY;
  slot.lastContinuousTickAt = Number.NEGATIVE_INFINITY;
}

function isContinuousWeaponSlot(slot) {
  return sanitizeWeaponFireMode(slot?.fireMode) === 'continuous';
}

function createEmptyWeaponSlot(index) {
  return {
    index,
    fn: null,
    name: '',
    code: '',
    tier: null,
    fireMode: DEFAULT_WEAPON_FIRE_MODE,
    cooldownMs: DEFAULT_WEAPON_COOLDOWN_MS,
    lastFiredAt: Number.NEGATIVE_INFINITY,
    channelStartedAt: Number.NEGATIVE_INFINITY,
    lastContinuousTickAt: Number.NEGATIVE_INFINITY,
  };
}

function normalizeLegacyLoadout(loadout) {
  const normalized = {
    activeIndex: 0,
    slots: Array.from({ length: WEAPON_LOADOUT_SIZE }, (_, index) => createEmptyWeaponSlot(index)),
  };
  if (!loadout) return normalized;
  if (Array.isArray(loadout.slots)) {
    normalized.activeIndex = clampSlotIndex(loadout.activeIndex) ?? 0;
    for (let i = 0; i < WEAPON_LOADOUT_SIZE && i < loadout.slots.length; i++) {
      const slot = loadout.slots[i] || {};
      normalized.slots[i] = {
        ...createEmptyWeaponSlot(i),
        fn: typeof slot.fn === 'function' ? slot.fn : null,
        name: typeof slot.name === 'string' ? slot.name : '',
        code: typeof slot.code === 'string' ? slot.code : '',
        tier: sanitizeWeaponTier(slot.tier),
        fireMode: sanitizeWeaponFireMode(slot.fireMode),
        cooldownMs: sanitizeCooldownMs(slot.cooldownMs),
        lastFiredAt: Number.isFinite(slot.lastFiredAt) ? slot.lastFiredAt : Number.NEGATIVE_INFINITY,
        channelStartedAt: Number.isFinite(slot.channelStartedAt) ? slot.channelStartedAt : Number.NEGATIVE_INFINITY,
        lastContinuousTickAt: Number.isFinite(slot.lastContinuousTickAt) ? slot.lastContinuousTickAt : Number.NEGATIVE_INFINITY,
      };
    }
    return normalized;
  }

  normalized.slots[0] = {
    ...createEmptyWeaponSlot(0),
    fn: typeof loadout.fn === 'function' ? loadout.fn : null,
    name: typeof loadout.name === 'string' ? loadout.name : '',
    code: typeof loadout.code === 'string' ? loadout.code : '',
    tier: sanitizeWeaponTier(loadout.tier),
    fireMode: sanitizeWeaponFireMode(loadout.fireMode),
    cooldownMs: sanitizeCooldownMs(loadout.cooldownMs),
  };
  return normalized;
}

function isNormalizedLoadout(loadout) {
  return Boolean(
    loadout
    && Array.isArray(loadout.slots)
    && loadout.slots.length === WEAPON_LOADOUT_SIZE
    && Number.isFinite(loadout.activeIndex)
  );
}

function ensureWeaponLoadout(ownerId = _localPlayerId) {
  const existing = weaponSlots.get(ownerId);
  if (isNormalizedLoadout(existing)) return existing;
  const normalized = normalizeLegacyLoadout(existing);
  weaponSlots.set(ownerId, normalized);
  return normalized;
}

function updateLocalWeaponLabel() {
  const slot = getWeaponSlot(_localPlayerId);
  const el = document.getElementById('weapon-name');
  if (el) el.textContent = slot?.name || 'No Weapon';
}

export function getWeaponLoadout(ownerId = _localPlayerId) {
  return ensureWeaponLoadout(ownerId);
}

export function getActiveWeaponIndex(ownerId = _localPlayerId) {
  return ensureWeaponLoadout(ownerId).activeIndex;
}

export function getWeaponSlot(ownerId = _localPlayerId, slotIndex = null) {
  const loadout = ensureWeaponLoadout(ownerId);
  const resolvedIndex = clampSlotIndex(slotIndex ?? loadout.activeIndex);
  if (resolvedIndex == null) return null;
  return loadout.slots[resolvedIndex] || null;
}

export function getWeaponCooldownMs(ownerId = _localPlayerId, slotIndex = null) {
  return getWeaponSlot(ownerId, slotIndex)?.cooldownMs || DEFAULT_WEAPON_COOLDOWN_MS;
}

function getWeaponChannelRemainingSeconds(slot) {
  if (!slot || !isContinuousWeaponSlot(slot) || !Number.isFinite(slot.channelStartedAt)) return 0;
  const remaining = getWeaponFireProfile(slot.tier, slot.fireMode).channelMs / 1000 - (elapsed - slot.channelStartedAt);
  return Math.max(0, remaining);
}

function getWeaponFireState(ownerId = _localPlayerId, slotIndex = null) {
  const slot = getWeaponSlot(ownerId, slotIndex);
  if (!slot) return 'ready';
  if (isContinuousWeaponSlot(slot) && getWeaponChannelRemainingSeconds(slot) > 0) return 'channeling';
  if (getWeaponCooldownRemaining(ownerId, slotIndex) > 0) {
    return isContinuousWeaponSlot(slot) ? 'recovering' : 'cooldown';
  }
  return 'ready';
}

export function getWeaponCooldownRemaining(ownerId = _localPlayerId, slotIndex = null) {
  const slot = getWeaponSlot(ownerId, slotIndex);
  if (!slot) return 0;
  if (isContinuousWeaponSlot(slot) && getWeaponChannelRemainingSeconds(slot) > 0) return 0;
  const remaining = slot.cooldownMs / 1000 - (elapsed - slot.lastFiredAt);
  return Math.max(0, remaining);
}

export function getWeaponLoadoutSnapshot(ownerId = _localPlayerId) {
  const loadout = ensureWeaponLoadout(ownerId);
  return loadout.slots.map((slot, index) => ({
    index,
    name: slot.name,
    hasWeapon: typeof slot.fn === 'function',
    tier: slot.tier,
    fireMode: slot.fireMode,
    fireState: getWeaponFireState(ownerId, index),
    channelRemaining: getWeaponChannelRemainingSeconds(slot),
    cooldownMs: slot.cooldownMs,
    cooldownRemaining: getWeaponCooldownRemaining(ownerId, index),
    isActive: index === loadout.activeIndex,
  }));
}

export function selectWeaponSlot(slotIndex, ownerId = _localPlayerId) {
  const loadout = ensureWeaponLoadout(ownerId);
  const resolvedIndex = clampSlotIndex(slotIndex);
  if (resolvedIndex == null) return false;
  if (resolvedIndex !== loadout.activeIndex) {
    releaseFire(ownerId, loadout.activeIndex);
  }
  loadout.activeIndex = resolvedIndex;
  if (ownerId === _localPlayerId) updateLocalWeaponLabel();
  return true;
}

export function getWeaponName(ownerId = _localPlayerId, slotIndex = null) {
  return getWeaponSlot(ownerId, slotIndex)?.name || '';
}

export function getWeaponCode(ownerId = _localPlayerId, slotIndex = null) {
  return getWeaponSlot(ownerId, slotIndex)?.code || '';
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

function getActorTorsoOrigin(actor = _player) {
  if (actor?.torsoOrigin?.isVector3) return actor.torsoOrigin.clone();
  return actor.pos.clone().add(new THREE.Vector3(0, PLAYER_TORSO_ORIGIN_Y, 0));
}

function getActorShootOrigin(actor = _player) {
  if (actor?.shootOrigin?.isVector3) return actor.shootOrigin.clone();
  const muzzleTip = actor?.mesh?.userData?.rig?.muzzleTip;
  if (muzzleTip && typeof muzzleTip.getWorldPosition === 'function') {
    return muzzleTip.getWorldPosition(new THREE.Vector3());
  }
  return getActorTorsoOrigin(actor);
}

function getActorAimDirection(actor, yaw, aimPoint = null) {
  if (actor?.direction?.isVector3 && actor.direction.lengthSq() > 1e-6) {
    return actor.direction.clone().normalize();
  }
  const origin = getActorShootOrigin(actor);
  const resolvedAimPoint = aimPoint ?? getPlayerAimPoint();
  if (resolvedAimPoint) {
    const dir = resolvedAimPoint.sub(origin);
    if (dir.lengthSq() > 1e-6) return dir.normalize();
  }
  return getPlayerFacingDirection(yaw);
}

function getPlayerAimDirection(yaw) {
  const aimPoint = getPlayerAimPoint();
  return getActorAimDirection(_player, yaw, aimPoint);
}

export function tickShake(dt) {
  if (shakeTime > 0) shakeTime -= dt;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Update particle pool (called from main loop) Ã¢â€â‚¬Ã¢â€â‚¬
export function updateParticles(dt) {
  if (_particlePool) _particlePool.update(dt);
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Entity management Ã¢â€â‚¬Ã¢â€â‚¬
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
    const prevPos = e.pos.clone();
    if (e.gravity !== 0) e.vel.y -= 9.81 * (e.gravity ?? 1) * dt;
    e.pos.add(e.vel.clone().multiplyScalar(dt));

    const moveDelta = e.pos.clone().sub(prevPos);
    const moveDistance = moveDelta.length();
    if (moveDistance > 1e-5 && e.worldCollision !== false) {
      const hit = raycastWorld(prevPos, moveDelta, moveDistance + (e.radius ?? 0.5) + 0.05);
      if (hit && hit.distance <= moveDistance + (e.radius ?? 0.5) + 0.05) {
        const normal = hit.normal ?? computeHitNormal(hit, moveDelta);
        e.pos.copy(hit.point).addScaledVector(normal, (e.radius ?? 0.5) + 0.03);

        let response = e.worldCollisionResponse ?? (((e.bounce ?? 0) > 0.2) ? 'bounce' : 'stop');
        if (typeof e.onWorldCollision === 'function') {
          try {
            const result = e.onWorldCollision({ hit, normal: normal.clone(), point: hit.point.clone(), entity: e });
            if (result === false || result === 'destroy') response = 'destroy';
            else if (typeof result === 'string') response = result;
          } catch (err) {
            console.error(err);
            response = 'destroy';
          }
        }

        if (response === 'destroy') {
          destroyEntity(e);
          continue;
        }

        if (response === 'bounce') {
          const bounce = Math.max(0, e.bounce ?? 0.3);
          const vn = e.vel.dot(normal);
          if (vn < 0) {
            e.vel.addScaledVector(normal, -(1 + bounce) * vn);
          }
          e.vel.multiplyScalar(Math.max(0.15, bounce));
        } else {
          e.vel.set(0, 0, 0);
        }
      }
    }

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
      else t.update(t.getHeadPoint() ?? TRAIL_FALLBACK_POINT, _camera.position);
    }
  }
}

export function updateSandboxTimers(dt, opts = {}) {
  const { skipEnemyStatus = false } = opts;
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

  updatePooledTransientEffects();

  // Tick enemy status effects (burn/freeze/slow/stun timers)
  const combatants = getTrackedCombatants();
  if (combatants.length && !skipEnemyStatus) {
    for (const e of combatants) {
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

function extendPeerStateOverride(e, seconds = 0.25) {
  if (!e || typeof performance?.now !== 'function') return 0;
  const durationMs = Math.max(0, Number(seconds) || 0) * 1000;
  if (durationMs <= 0) return 0;
  const until = performance.now() + durationMs;
  e.ignorePeerStateUntil = Math.max(e.ignorePeerStateUntil || 0, until);
  return e.ignorePeerStateUntil;
}

function flashEnemyHit(e, opts = {}) {
  if (!e?.bodyMesh?.material) return;
  const { color = 0xffffff, intensity = 1.9, durationMs = 80 } = opts;
  e.bodyMesh.material.emissive.set(color);
  e.bodyMesh.material.emissiveIntensity = intensity;
  setTimeout(() => {
    if ((e.hp ?? 0) > 0 && e.bodyMesh?.material) {
      e.bodyMesh.material.emissive.set(0);
      e.bodyMesh.material.emissiveIntensity = 0;
    }
  }, durationMs);
}

function damageEnemy(e, amt, flashOpts = {}, damageMeta = {}) {
  if (!canMutateEnemies() || !isCombatantAlive(e) || !Number.isFinite(amt) || amt <= 0) return 0;
  e.hp = Math.max(0, e.hp - amt);
  e.lastDamagedBy = damageMeta.sourceId || damageMeta.ownerId || null;
  flashEnemyHit(e, flashOpts);
  if (e.hp <= 0) {
    queueDeathEffect(e.pos);
    if (typeof _effects?.onCombatantEliminated === 'function') {
      try {
        _effects.onCombatantEliminated(e, damageMeta);
      } catch (err) {
        console.error(err);
      }
    }
    respawn(e, damageMeta);
  }
  return amt;
}

// Scorch mark helper
function addFlashLight(position, color, intensity, distance, duration) {
  const light = acquireFlashLight();
  light.color.set(color);
  light.intensity = intensity;
  light.distance = distance;
  light.position.copy(position);

  if (!addManagedLight(light)) {
    flashLightPool.push(light);
    return null;
  }

  const entry = {
    light,
    startTime: elapsed,
    duration,
    startIntensity: intensity,
  };
  activeFlashLights.push(entry);
  return entry;
}

function addScorchMark(position, radius) {
  const size = radius * 0.6;
  const entry = acquireScorchMark();
  entry.startTime = elapsed;
  entry.duration = 8;
  entry.maxOpacity = 0.5;
  entry.mesh.material.opacity = entry.maxOpacity;
  entry.mesh.scale.set(size, size, 1);
  entry.mesh.position.set(position.x, 0.03, position.z);
  entry.mesh.visible = true;
  if (entry.mesh.parent !== _scene) _scene.add(entry.mesh);
  activeScorchMarks.push(entry);
  return entry;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Respawn enemy Ã¢â€â‚¬Ã¢â€â‚¬
function addShockwaveRing(position, radius, color) {
  const entry = acquireShockwaveRing();
  entry.startTime = elapsed;
  entry.duration = 0.35;
  entry.radius = radius;
  entry.maxOpacity = 0.7;
  entry.mesh.material.color.set(color);
  entry.mesh.material.opacity = entry.maxOpacity;
  entry.mesh.scale.setScalar(1);
  entry.mesh.position.copy(position);
  entry.mesh.position.y += 0.1;
  entry.mesh.visible = true;
  if (entry.mesh.parent !== _scene) _scene.add(entry.mesh);
  activeShockwaveRings.push(entry);
  return entry;
}

function respawn(e, damageMeta = {}) {
  const finishRespawn = () => {
    const respawnPosition = typeof _effects?.getRespawnPosition === 'function'
      ? _effects.getRespawnPosition(e, damageMeta)
      : null;
    e.pendingRespawn = false;
    e.hp = e.maxHp || 100;
    if (respawnPosition) e.pos.copy(respawnPosition);
    else e.pos.set((Math.random() - 0.5) * 80, 0.6, (Math.random() - 0.5) * 80);
    e.vel.set(0, 0, 0);
    clearEnemyStatuses(e);
    if (e.bodyMesh?.material) {
      e.bodyMesh.material.emissive.set(0x000000);
      e.bodyMesh.material.emissiveIntensity = 0;
    }
    if (typeof _effects?.onCombatantRespawn === 'function') {
      try {
        _effects.onCombatantRespawn(e, damageMeta);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const delaySeconds = typeof _effects?.getRespawnDelaySeconds === 'function'
    ? Math.max(0, Number(_effects.getRespawnDelaySeconds(e, damageMeta)) || 0)
    : 0;

  e.vel.set(0, 0, 0);
  clearEnemyStatuses(e);
  e.pendingRespawn = delaySeconds > 0;
  e.respawnToken = (e.respawnToken || 0) + 1;
  const token = e.respawnToken;

  if (delaySeconds > 0) {
    if (typeof _effects?.onCombatantPendingRespawn === 'function') {
      try {
        _effects.onCombatantPendingRespawn(e, damageMeta, delaySeconds);
      } catch (err) {
        console.error(err);
      }
    }
    timers.push({
      r: delaySeconds,
      f: () => {
        if ((e.respawnToken || 0) !== token) return;
        finishRespawn();
      },
    });
    return;
  }

  finishRespawn();
}
// Ã¢â€â‚¬Ã¢â€â‚¬ Death effect Ã¢â€â‚¬Ã¢â€â‚¬
function playDeathEffect(position) {
  const pos = position?.isVector3 ? position : new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0);
  if (_effects.triggerSlowMo) _effects.triggerSlowMo(0.35, 0.12);
  if (_effects.triggerFlash) _effects.triggerFlash(0.25);
  addScorchMark(pos, 3);

  // Use particle pool instead of individual meshes.
  _particlePool.burst({
    position: pos, color: 0xff6644, count: 25,
    speed: 12, lifetime: 1.0, size: 5, gravity: 1.2,
  });
  _particlePool.burst({
    position: pos, color: 0xffaa44, count: 15,
    speed: 8, lifetime: 0.7, size: 3, gravity: 0.8,
  });

  addFlashLight(pos, 0xff6600, 4.5, 14, 0.35);
}

function queueDeathEffect(position) {
  const pos = position?.isVector3 ? position.clone() : new THREE.Vector3(position?.x || 0, position?.y || 0, position?.z || 0);
  const scheduledAt = queuedDeathEffects.length > 0
    ? Math.max(queuedDeathEffects[queuedDeathEffects.length - 1].scheduledAt, elapsed) + DEATH_EFFECT_STAGGER
    : elapsed;
  queuedDeathEffects.push({ position: pos, scheduledAt });
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Build the context passed to AI weapon code Ã¢â€â‚¬Ã¢â€â‚¬
export function buildCtx(actorState = null) {
  const compatTHREE = getCompatThree();
  const toVec3 = (v) => {
    if (v instanceof THREE.Vector3) return v.clone();
    return new THREE.Vector3(v?.x || 0, v?.y || 0, v?.z || 0);
  };
  const hasMeshOverride = actorState && Object.prototype.hasOwnProperty.call(actorState, 'mesh');
  const actor = actorState ? {
    id: actorState.id || actorState.playerId || _localPlayerId,
    pos: toVec3(actorState.pos ?? actorState.position ?? _player.pos),
    vel: toVec3(actorState.vel ?? actorState.velocity ?? _player.vel),
    mesh: hasMeshOverride ? actorState.mesh : _player.mesh,
    yaw: Number.isFinite(actorState.yaw) ? actorState.yaw : _playerYaw(),
    aimPoint: actorState.aimPoint ? toVec3(actorState.aimPoint) : getPlayerAimPoint(),
    shootOrigin: actorState.shootOrigin ? toVec3(actorState.shootOrigin) : null,
    torsoOrigin: actorState.torsoOrigin ? toVec3(actorState.torsoOrigin) : null,
    direction: actorState.direction ? toVec3(actorState.direction) : null,
    teamId: actorState.teamId || null,
  } : {
    id: _localPlayerId,
    pos: _player.pos.clone(),
    vel: _player.vel.clone(),
    mesh: _player.mesh,
    yaw: _playerYaw(),
    aimPoint: getPlayerAimPoint(),
    shootOrigin: null,
    torsoOrigin: null,
    direction: null,
    teamId: null,
  };
  const actorCombatant = getCombatantById(actor.id);
  if (!actor.teamId) actor.teamId = getCombatantTeamId(actorCombatant);
  const yaw = actor.yaw;
  const aimPoint = actor.aimPoint?.clone() ?? null;
  const wrapEnemy = (e) => ({
    id: getCombatantId(e),
    teamId: getCombatantTeamId(e),
    position: e.pos.clone(),
    mesh: e.mesh,
    hp: e.hp,
    velocity: e.vel.clone(),
    takeDamage: (amt) => {
      if (!canMutateEnemies()) return 0;
      return damageEnemy(e, amt, {}, { sourceId: actor.id, sourceTeamId: actor.teamId });
    },
    // NO hidden multiplier - force directly adds to velocity
    applyForce: (f) => {
      if (!canMutateEnemies()) return e.vel.clone();
      e.vel.x += (f.x || 0);
      e.vel.y += (f.y || 0);
      e.vel.z += (f.z || 0);
      extendPeerStateOverride(e, 0.3);
      return e.vel.clone();
    },
    setVelocity: (v) => {
      if (!canMutateEnemies()) return e.vel.clone();
      e.vel.x = v?.x || 0;
      e.vel.y = v?.y || 0;
      e.vel.z = v?.z || 0;
      extendPeerStateOverride(e, 0.3);
      return e.vel.clone();
    },
    dampVelocity: (multiplier = 0.8, opts = {}) => {
      if (!canMutateEnemies()) return e.vel.clone();
      const m = THREE.MathUtils.clamp(multiplier, 0, 1);
      e.vel.x *= m;
      if (opts.includeY) e.vel.y *= m;
      e.vel.z *= m;
      extendPeerStateOverride(e, 0.25);
      return e.vel.clone();
    },
    freeze: (seconds = 0.75, opts = {}) => {
      if (!canMutateEnemies()) return ensureEnemyStatus(e).freeze;
      const s = ensureEnemyStatus(e);
      s.freeze = Math.max(s.freeze, Math.max(0, seconds || 0));
      if (opts.zeroVelocity !== false) e.vel.set(0, 0, 0);
      extendPeerStateOverride(e, Math.max(0.25, seconds || 0));
      return s.freeze;
    },
    stun: (seconds = 0.4) => {
      if (!canMutateEnemies()) return ensureEnemyStatus(e).stun;
      const s = ensureEnemyStatus(e);
      s.stun = Math.max(s.stun, Math.max(0, seconds || 0));
      extendPeerStateOverride(e, Math.max(0.2, seconds || 0));
      return s.stun;
    },
    slow: (multiplier = 0.35, seconds = 1.2) => {
      if (!canMutateEnemies()) {
        const s = ensureEnemyStatus(e);
        return { multiplier: s.slowMult, remaining: s.slowTime };
      }
      const s = ensureEnemyStatus(e);
      const m = THREE.MathUtils.clamp(multiplier, 0, 1);
      s.slowMult = s.slowTime > 0 ? Math.min(s.slowMult, m) : m;
      s.slowTime = Math.max(s.slowTime, Math.max(0, seconds || 0));
      extendPeerStateOverride(e, Math.min(Math.max(0.2, seconds || 0), 0.6));
      return { multiplier: s.slowMult, remaining: s.slowTime };
    },
    ignite: (opts = {}) => {
      if (!canMutateEnemies()) {
        const s = ensureEnemyStatus(e);
        return { dps: s.burnDps, remaining: s.burnTime };
      }
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
      getPosition: () => getActorShootOrigin(actor),
      getTorsoPosition: () => getActorTorsoOrigin(actor),
      getFeetPosition: () => actor.pos.clone(),
      getShootOrigin: () => getActorShootOrigin(actor),
      getAimPoint: () => aimPoint?.clone() ?? null,
      getDirection: () => getActorAimDirection(actor, yaw, aimPoint?.clone() ?? null),
      getFacingDirection: () => getPlayerFacingDirection(yaw),
      getRight: () => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
      getUp: () => new THREE.Vector3(0, 1, 0),
      getVelocity: () => actor.vel.clone(),
      getQuaternion: () => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    },

    getEnemies: () => getOpposingCombatants(actor).map(wrapEnemy),

    spawn: (mesh, opt = {}) => {
      const { position = new THREE.Vector3(), velocity = new THREE.Vector3(), angularVelocity = null,
        gravity = 1, radius = 0.5, bounce = 0.3, lifetime = null, onUpdate = null,
        worldCollision = true, worldCollisionResponse = null, onWorldCollision = null } = opt;
      const vel = velocity instanceof THREE.Vector3 ? velocity.clone() : new THREE.Vector3(velocity.x || 0, velocity.y || 0, velocity.z || 0);
      const pos = position instanceof THREE.Vector3 ? position.clone() : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);
      mesh.position.copy(pos);
      _scene.add(mesh);
      const ent = {
        mesh, pos, vel,
        angVel: angularVelocity ? { x: angularVelocity.x || 0, y: angularVelocity.y || 0, z: angularVelocity.z || 0 } : null,
        gravity, radius, bounce, lifetime, age: 0, onUpdate, alive: true,
        worldCollision, worldCollisionResponse, onWorldCollision,
        get position() { return pos; },
        set position(v) {
          pos.set(v?.x || 0, v?.y || 0, v?.z || 0);
          mesh.position.copy(pos);
        },
        get velocity() { return vel; },
        set velocity(v) { vel.set(v?.x || 0, v?.y || 0, v?.z || 0); },
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
    addLight: (l) => addManagedLight(l),
    removeLight: (l) => removeManagedLight(l),
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
      return getOpposingCombatants(actor)
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
      if (!canMutateEnemies()) return 0;
      const c = toVec3(center);
      const radius = Math.max(0.001, opts.radius ?? 8);
      const strength = opts.strength ?? 10;
      const mode = opts.mode === 'inward' ? 'inward' : 'outward';
      const lift = opts.lift ?? 0;
      const falloffMode = opts.falloff === 'none' ? 'none' : 'linear';
      let affected = 0;

      for (const e of getOpposingCombatants(actor)) {
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
    // Ã¢â€â‚¬Ã¢â€â‚¬ Trail Renderer Ã¢â€â‚¬Ã¢â€â‚¬
    createTrail: (opts = {}) => {
      const t = new Trail(_scene, opts);
      trails.push(t);
      return t;
    },

    // Ã¢â€â‚¬Ã¢â€â‚¬ GPU Particle Burst (single draw call) Ã¢â€â‚¬Ã¢â€â‚¬
    burstParticles: (opts = {}) => {
      if (_particlePool) _particlePool.burst(opts);
    },

    // Ã¢â€â‚¬Ã¢â€â‚¬ Explosion Helper (now uses particle pool) Ã¢â€â‚¬Ã¢â€â‚¬
    explode: (position, opts = {}) => {
      const { radius = 5, damage = 30, force = 15, color = 0xff6600, particles = 15, lightIntensity = 3.8 } = opts;
      const p = position instanceof THREE.Vector3 ? position : new THREE.Vector3(position.x || 0, position.y || 0, position.z || 0);

      if (_effects.triggerFlash) _effects.triggerFlash(0.12);
      addScorchMark(p, radius);

      // Damage + push enemies
      if (canMutateEnemies()) {
        for (const e of getOpposingCombatants(actor)) {
          const d = e.pos.distanceTo(p);
          if (d < radius) {
            const falloff = 1 - d / radius;
            const dir = e.pos.clone().sub(p).normalize();
            e.vel.add(dir.multiplyScalar(force * falloff));
            damageEnemy(e, damage * falloff, {}, { sourceId: actor.id, sourceTeamId: actor.teamId });
          }
        }
      }

      // Light flash (single light)
      addFlashLight(p, color, lightIntensity, radius * 2.5, 0.25);

      // Particles via pool Ã¢â‚¬â€ ONE draw call, no mesh spam
      _particlePool.burst({
        position: p, color, count: particles,
        speed: 10, lifetime: 0.7, size: 4, gravity: 1,
      });
      // Secondary darker smoke burst
      _particlePool.burst({
        position: p, color: 0x443322, count: Math.floor(particles * 0.5),
        speed: 5, lifetime: 1.0, size: 6, gravity: 0.3,
      });

      // Shockwave ring (single mesh, pooled and reused)
      addShockwaveRing(p, radius, color);

      shakeAmt = Math.min(1.2, radius * 0.12);
      shakeTime = 0.2;
    },

    raycast: (o, d, mx = 100) => {
      const origin = o instanceof THREE.Vector3 ? o : new THREE.Vector3(o.x, o.y, o.z);
      const dir = d instanceof THREE.Vector3 ? d.clone().normalize() : new THREE.Vector3(d.x, d.y, d.z).normalize();
      const worldHit = raycastWorld(origin, dir, mx);
      if (worldHit) {
        return {
          point: worldHit.point.clone(),
          distance: worldHit.distance,
          normal: worldHit.normal?.clone?.() ?? null,
          object: worldHit.object ?? null,
          hit: true,
        };
      }
      if (dir.y < -0.001) {
        const t = -origin.y / dir.y;
        if (t > 0 && t < mx) {
          return {
            point: origin.clone().add(dir.clone().multiplyScalar(t)),
            distance: t,
            normal: new THREE.Vector3(0, 1, 0),
            object: null,
            hit: true,
          };
        }
      }
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Fire weapon Ã¢â€â‚¬Ã¢â€â‚¬
function invokeWeaponSlot(slot, actorState) {
  try {
    slot.fn(buildCtx(actorState));
    return true;
  } catch (e) {
    console.error('Weapon error:', e);
    return false;
  }
}

function fireContinuousSlot(slot, actorState, ownerId) {
  const profile = getWeaponFireProfile(slot.tier, slot.fireMode);
  const recoverySeconds = Math.max(0.05, profile.cooldownMs / 1000);
  if (!Number.isFinite(slot.channelStartedAt) || slot.channelStartedAt === Number.NEGATIVE_INFINITY) {
    if (elapsed - slot.lastFiredAt < recoverySeconds) return false;
    slot.channelStartedAt = elapsed;
    slot.lastContinuousTickAt = Number.NEGATIVE_INFINITY;
  }

  if (getWeaponChannelRemainingSeconds(slot) <= 0) {
    releaseFire(ownerId);
    return false;
  }

  const tickSeconds = Math.max(0.05, profile.tickMs / 1000);
  if (elapsed - slot.lastContinuousTickAt < tickSeconds) return false;
  slot.lastContinuousTickAt = elapsed;
  return invokeWeaponSlot(slot, actorState);
}

export function fire(actorState = null, opts = {}) {
  const ownerId = opts.ownerId || actorState?.id || actorState?.playerId || _localPlayerId;
  const slot = getWeaponSlot(ownerId);
  if (!slot?.fn) return false;

  if (opts.bypassRateLimit) {
    return invokeWeaponSlot(slot, actorState);
  }

  if (isContinuousWeaponSlot(slot)) {
    return fireContinuousSlot(slot, actorState, ownerId);
  }

  const cooldownSeconds = Math.max(0.05, (slot.cooldownMs || DEFAULT_WEAPON_COOLDOWN_MS) / 1000);
  if (elapsed - slot.lastFiredAt < cooldownSeconds) return false;
  slot.lastFiredAt = elapsed;
  return invokeWeaponSlot(slot, actorState);
}

export function releaseFire(ownerId = _localPlayerId, slotIndex = null) {
  const slot = getWeaponSlot(ownerId, slotIndex);
  if (!slot || !isContinuousWeaponSlot(slot)) return false;
  if (!Number.isFinite(slot.channelStartedAt) || slot.channelStartedAt === Number.NEGATIVE_INFINITY) return false;
  slot.channelStartedAt = Number.NEGATIVE_INFINITY;
  slot.lastContinuousTickAt = Number.NEGATIVE_INFINITY;
  slot.lastFiredAt = elapsed;
  return true;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Set current weapon Ã¢â€â‚¬Ã¢â€â‚¬
export function setWeapon(fn, name, ownerId = _localPlayerId, opts = {}) {
  const {
    code = '',
    reset = false,
    slotIndex = null,
    tier = null,
    fireMode = DEFAULT_WEAPON_FIRE_MODE,
    cooldownMs = DEFAULT_WEAPON_COOLDOWN_MS,
  } = opts;

  if (reset) resetSandbox();
  const loadout = ensureWeaponLoadout(ownerId);
  const resolvedIndex = clampSlotIndex(slotIndex ?? loadout.activeIndex) ?? loadout.activeIndex;
  const slot = loadout.slots[resolvedIndex] || createEmptyWeaponSlot(resolvedIndex);
  slot.fn = fn;
  slot.name = name;
  slot.code = code;
  slot.tier = sanitizeWeaponTier(tier);
  slot.fireMode = sanitizeWeaponFireMode(fireMode);
  slot.cooldownMs = sanitizeCooldownMs(cooldownMs);
  resetWeaponSlotTiming(slot);
  loadout.slots[resolvedIndex] = slot;

  if (ownerId === _localPlayerId && resolvedIndex === loadout.activeIndex) {
    updateLocalWeaponLabel();
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Full cleanup Ã¢â€â‚¬Ã¢â€â‚¬
export function resetSandbox(opts = {}) {
  const { clearWeapons = false } = opts;
  resetPooledTransientEffects();
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
  if (clearWeapons) {
    weaponSlots.clear();
  } else {
    for (const [ownerId, loadout] of weaponSlots.entries()) {
      const normalized = isNormalizedLoadout(loadout) ? loadout : normalizeLegacyLoadout(loadout);
      if (normalized !== loadout) weaponSlots.set(ownerId, normalized);
      for (const slot of normalized.slots) {
        resetWeaponSlotTiming(slot);
      }
    }
  }
}















