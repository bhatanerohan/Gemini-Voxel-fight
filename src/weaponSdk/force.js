import { falloffWeight, getEnemyPosition, normalizeDirection, toVec3 } from './utils.js';
import { queryEnemiesInCone, queryEnemiesInRadius } from './targeting.js';

function clampMagnitude(vec, maxMagnitude) {
  if (!(Number.isFinite(maxMagnitude) && maxMagnitude > 0)) return vec;
  if (vec.length() > maxMagnitude) vec.setLength(maxMagnitude);
  return vec;
}

export function createForceHelpers(runtime) {
  const { THREE } = runtime;

  return {
    applyForceToEnemy: (enemy, opts = {}) => {
      if (!enemy || typeof enemy.applyForce !== 'function') return new THREE.Vector3();

      const out = new THREE.Vector3(
        opts.x || 0,
        opts.y || 0,
        opts.z || 0,
      );

      if (opts.direction != null) {
        const dir = normalizeDirection(runtime, opts.direction);
        out.addScaledVector(dir, opts.strength ?? 0);
      }

      if (opts.lift != null) out.y += opts.lift;
      clampMagnitude(out, opts.maxMagnitude);
      enemy.applyForce({ x: out.x, y: out.y, z: out.z });
      return out.clone();
    },

    applyForceCone: (origin, direction, opts = {}) => {
      const o = toVec3(runtime, origin);
      const dir = normalizeDirection(runtime, direction);
      const range = Math.max(0.001, opts.range ?? 10);
      const strength = opts.strength ?? 8;
      const lift = opts.lift ?? 0;
      const falloff = opts.falloff ?? 'linear';
      const alignToTarget = !!opts.alignToTarget;
      const targets = queryEnemiesInCone(runtime, o, dir, {
        range,
        angleDeg: opts.angleDeg,
        max: opts.max,
        sortBy: opts.sortBy,
      });

      for (const enemy of targets) {
        const ep = getEnemyPosition(runtime, enemy);
        if (!ep || typeof enemy.applyForce !== 'function') continue;
        const nd = ep.distanceTo(o) / range;
        const w = falloffWeight(falloff, nd);
        const pushDir = alignToTarget ? ep.sub(o).normalize() : dir.clone();
        enemy.applyForce({
          x: pushDir.x * strength * w,
          y: pushDir.y * strength * w + lift * w,
          z: pushDir.z * strength * w,
        });
      }

      return { count: targets.length, targets };
    },

    dampEnemiesInRadius: (center, opts = {}) => {
      const c = toVec3(runtime, center);
      const radius = Math.max(0, opts.radius ?? 8);
      const multiplier = opts.multiplier ?? 0.8;
      const includeY = !!opts.includeY;
      const targets = queryEnemiesInRadius(runtime, c, { radius, max: opts.max, sortBy: opts.sortBy });
      let count = 0;
      for (const enemy of targets) {
        if (typeof enemy?.dampVelocity === 'function') {
          enemy.dampVelocity(multiplier, { includeY });
          count++;
        }
      }
      return { count, targets };
    },
  };
}

