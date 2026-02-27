export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

export function toVec3(runtime, value) {
  if (runtime?.toVec3) return runtime.toVec3(value);
  const { THREE } = runtime;
  if (value?.isVector3) return value.clone();
  return new THREE.Vector3(value?.x || 0, value?.y || 0, value?.z || 0);
}

export function normalizeDirection(runtime, direction, fallback = { x: 0, y: 0, z: -1 }) {
  const dir = toVec3(runtime, direction);
  if (dir.lengthSq() < 1e-6) {
    dir.set(fallback.x || 0, fallback.y || 0, fallback.z ?? -1);
  }
  return dir.normalize();
}

export function getEnemyPosition(runtime, enemy) {
  if (!enemy) return null;
  if (enemy.mesh?.position?.isVector3) return enemy.mesh.position.clone();
  if (enemy.position?.isVector3) return enemy.position.clone();
  if (enemy.pos?.isVector3) return enemy.pos.clone();
  const p = enemy.position || enemy.pos;
  if (p && typeof p.x === 'number') return toVec3(runtime, p);
  return null;
}

export function enemyDistanceTo(runtime, enemy, point) {
  const p = toVec3(runtime, point);
  if (typeof enemy?.distanceTo === 'function') {
    const d = enemy.distanceTo(p);
    if (Number.isFinite(d)) return d;
  }
  const ep = getEnemyPosition(runtime, enemy);
  return ep ? ep.distanceTo(p) : Infinity;
}

export function enemyKey(enemy) {
  return enemy?.mesh || enemy;
}

export function falloffWeight(falloff, normalizedDistance) {
  const nd = clamp01(normalizedDistance);
  const t = 1 - nd;
  switch (falloff) {
    case 'none':
      return 1;
    case 'quadratic':
      return t * t;
    case 'smooth':
      return t * t * (3 - 2 * t);
    case 'linear':
    default:
      return t;
  }
}

export function listEnemies(runtime) {
  if (typeof runtime?.getEnemies !== 'function') return [];
  const out = runtime.getEnemies();
  return Array.isArray(out) ? out : [];
}

export function resolvePointRef(runtime, ref) {
  if (typeof ref === 'function') return toVec3(runtime, ref());
  if (ref?.mesh?.position?.isVector3) return ref.mesh.position.clone();
  if (ref?.position?.isVector3) return ref.position.clone();
  return toVec3(runtime, ref);
}

export function addVisualObject(runtime, obj) {
  if (typeof runtime?.addObject === 'function') return runtime.addObject(obj);
  if (typeof runtime?.addMesh === 'function') return runtime.addMesh(obj);
  if (runtime?.scene && typeof runtime.scene.add === 'function') runtime.scene.add(obj);
  return obj;
}

export function removeVisualObject(runtime, obj) {
  if (!obj) return;
  if (typeof runtime?.removeMesh === 'function') {
    runtime.removeMesh(obj);
    return;
  }
  if (runtime?.scene && typeof runtime.scene.remove === 'function') runtime.scene.remove(obj);
}

export function registerLifetime(runtime, life, onFrame) {
  if (typeof runtime?.onUpdate !== 'function') return null;
  if (!(Number.isFinite(life) && life > 0)) return null;
  let age = 0;
  const cb = runtime.onUpdate((dt, elapsed) => {
    age += dt;
    const progress = clamp01(age / life);
    const keepAlive = onFrame?.({ dt, elapsed, age, life, progress });
    if (keepAlive === false) return false;
    if (age >= life) return false;
    return true;
  });
  return cb;
}

