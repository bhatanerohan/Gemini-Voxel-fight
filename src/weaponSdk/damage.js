import { falloffWeight, getEnemyPosition, normalizeDirection, toVec3 } from './utils.js';
import { queryEnemiesInCone, queryEnemiesInLine, queryEnemiesInRadius } from './targeting.js';

function applyDamage(enemy, amount) {
  const dmg = Math.max(0, amount || 0);
  if (!dmg) return 0;
  if (typeof enemy?.takeDamage === 'function') {
    enemy.takeDamage(dmg);
    return dmg;
  }
  return 0;
}

function makeSummary(targets, totalDamage) {
  return {
    count: targets.length,
    totalDamage,
    targets,
  };
}

export function createDamageHelpers(runtime) {
  return {
    damageEnemy: (enemy, opts = {}) => {
      const damage = typeof opts === 'number' ? opts : (opts.damage ?? 0);
      return applyDamage(enemy, damage);
    },

    damageRadius: (center, opts = {}) => {
      const c = toVec3(runtime, center);
      const radius = Math.max(0.001, opts.radius ?? 6);
      const baseDamage = Math.max(0, opts.damage ?? 10);
      const falloff = opts.falloff ?? 'linear';
      const targets = queryEnemiesInRadius(runtime, c, { radius, max: opts.max, sortBy: opts.sortBy });
      let totalDamage = 0;

      for (const enemy of targets) {
        const ep = getEnemyPosition(runtime, enemy);
        if (!ep) continue;
        const nd = ep.distanceTo(c) / radius;
        const w = falloffWeight(falloff, nd);
        totalDamage += applyDamage(enemy, baseDamage * w);
      }
      return makeSummary(targets, totalDamage);
    },

    damageCone: (origin, direction, opts = {}) => {
      const o = toVec3(runtime, origin);
      const range = Math.max(0.001, opts.range ?? 12);
      const baseDamage = Math.max(0, opts.damage ?? 8);
      const falloff = opts.falloff ?? 'linear';
      const targets = queryEnemiesInCone(runtime, o, direction, {
        range,
        angleDeg: opts.angleDeg,
        max: opts.max,
        sortBy: opts.sortBy,
      });
      let totalDamage = 0;

      for (const enemy of targets) {
        const ep = getEnemyPosition(runtime, enemy);
        if (!ep) continue;
        const nd = ep.distanceTo(o) / range;
        const w = falloffWeight(falloff, nd);
        totalDamage += applyDamage(enemy, baseDamage * w);
      }
      return makeSummary(targets, totalDamage);
    },

    damageBeam: (origin, direction, opts = {}) => {
      const o = toVec3(runtime, origin);
      const dir = normalizeDirection(runtime, direction);
      const range = Math.max(0.001, opts.range ?? 18);
      const width = Math.max(0, opts.width ?? 1);
      const baseDamage = Math.max(0, opts.damage ?? 10);
      const falloff = opts.falloff ?? 'none';
      const targets = queryEnemiesInLine(runtime, o, dir, {
        range,
        width,
        max: opts.max,
        sortBy: opts.sortBy,
      });
      let totalDamage = 0;

      for (const enemy of targets) {
        const ep = getEnemyPosition(runtime, enemy);
        if (!ep) continue;
        const along = Math.max(0, ep.sub(o).dot(dir));
        const nd = along / range;
        const w = falloffWeight(falloff, nd);
        totalDamage += applyDamage(enemy, baseDamage * w);
      }
      return makeSummary(targets, totalDamage);
    },
  };
}

