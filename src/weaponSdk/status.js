import { queryEnemiesInCone, queryEnemiesInRadius } from './targeting.js';
import { toVec3 } from './utils.js';

function normalizeSlowSpec(spec, opts) {
  if (spec == null) return null;
  if (typeof spec === 'number') {
    return {
      multiplier: spec,
      seconds: opts.slowSeconds ?? opts.duration ?? 1.2,
    };
  }
  if (typeof spec === 'object') {
    return {
      multiplier: spec.multiplier ?? spec.value ?? 0.35,
      seconds: spec.seconds ?? spec.duration ?? opts.slowSeconds ?? opts.duration ?? 1.2,
    };
  }
  return null;
}

function normalizeIgniteSpec(spec) {
  if (spec == null || spec === false) return null;
  if (spec === true) return {};
  if (typeof spec === 'object') return spec;
  return null;
}

function applyStatusToEnemy(enemy, opts = {}) {
  if (!enemy) return false;
  let didApply = false;

  if (typeof opts.freeze === 'number' && opts.freeze > 0 && typeof enemy.freeze === 'function') {
    enemy.freeze(opts.freeze, opts.freezeOpts || {});
    didApply = true;
  }

  if (typeof opts.stun === 'number' && opts.stun > 0 && typeof enemy.stun === 'function') {
    enemy.stun(opts.stun);
    didApply = true;
  }

  const slow = normalizeSlowSpec(opts.slow, opts);
  if (slow && typeof enemy.slow === 'function') {
    enemy.slow(slow.multiplier, slow.seconds);
    didApply = true;
  }

  const ignite = normalizeIgniteSpec(opts.ignite);
  if (ignite && typeof enemy.ignite === 'function') {
    enemy.ignite(ignite);
    didApply = true;
  }

  return didApply;
}

function areaStatusSummary(targets, count) {
  return { count, targets };
}

export function createStatusHelpers(runtime) {
  return {
    applyStatus: (enemy, opts = {}) => applyStatusToEnemy(enemy, opts),

    applyStatusRadius: (center, opts = {}) => {
      const c = toVec3(runtime, center);
      const radius = Math.max(0, opts.radius ?? 6);
      const targets = queryEnemiesInRadius(runtime, c, { radius, max: opts.max, sortBy: opts.sortBy });
      let count = 0;
      for (const enemy of targets) {
        if (applyStatusToEnemy(enemy, opts)) count++;
      }
      return areaStatusSummary(targets, count);
    },

    applyStatusCone: (origin, direction, opts = {}) => {
      const o = toVec3(runtime, origin);
      const targets = queryEnemiesInCone(runtime, o, direction, {
        range: opts.range,
        angleDeg: opts.angleDeg,
        max: opts.max,
        sortBy: opts.sortBy,
      });
      let count = 0;
      for (const enemy of targets) {
        if (applyStatusToEnemy(enemy, opts)) count++;
      }
      return areaStatusSummary(targets, count);
    },
  };
}

