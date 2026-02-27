import {
  clamp,
  enemyDistanceTo,
  enemyKey,
  getEnemyPosition,
  listEnemies,
  normalizeDirection,
  toVec3,
} from './utils.js';

function sortEnemies(runtime, enemies, center, sortBy) {
  if (!sortBy || sortBy === 'distance' || sortBy === 'nearest') {
    const c = toVec3(runtime, center);
    enemies.sort((a, b) => enemyDistanceTo(runtime, a, c) - enemyDistanceTo(runtime, b, c));
    return enemies;
  }
  if (sortBy === 'farthest') {
    const c = toVec3(runtime, center);
    enemies.sort((a, b) => enemyDistanceTo(runtime, b, c) - enemyDistanceTo(runtime, a, c));
    return enemies;
  }
  if (sortBy === 'lowestHp' || sortBy === 'hp') {
    enemies.sort((a, b) => (a?.hp ?? Infinity) - (b?.hp ?? Infinity));
    return enemies;
  }
  return enemies;
}

function applyLimit(enemies, max) {
  if (!Number.isFinite(max)) return enemies;
  return enemies.slice(0, Math.max(0, Math.floor(max)));
}

function sortLineHits(hits, sortBy) {
  const sortKey = typeof sortBy === 'string' ? sortBy : '';
  if (!sortKey || sortKey === 'along' || sortKey === 'distance' || sortKey === 'nearest' || sortKey === 't') {
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }
  if (sortKey === 'farthest') {
    hits.sort((a, b) => b.t - a.t);
    return hits;
  }
  if (sortKey === 'lowestHp' || sortKey === 'hp') {
    hits.sort((a, b) => (a.enemy?.hp ?? Infinity) - (b.enemy?.hp ?? Infinity));
    return hits;
  }
  if (sortKey === 'distToLine') {
    hits.sort((a, b) => a.distToLine - b.distToLine);
    return hits;
  }
  return hits;
}

function computeLineHits(runtime, origin, direction, opts, useIgnoreY) {
  const o = toVec3(runtime, origin);
  const baseDir = normalizeDirection(runtime, direction);
  const range = Math.max(0, opts.range ?? 20);

  const widthBase = Math.max(0, opts.width ?? opts.radius ?? 1);
  const inflate = Math.max(0, opts.inflate ?? 0);
  const targetRadius = Math.max(0, opts.targetRadius ?? 0.45);
  const width = widthBase + inflate + targetRadius;
  const widthSq = width * width;

  const ignoreY = !!useIgnoreY;
  const rayOrigin = ignoreY ? toVec3(runtime, { x: o.x, y: 0, z: o.z }) : o.clone();
  const rayDir = ignoreY
    ? normalizeDirection(runtime, { x: baseDir.x, y: 0, z: baseDir.z })
    : baseDir.clone();

  if (ignoreY && Math.abs(rayDir.x) < 1e-6 && Math.abs(rayDir.z) < 1e-6) return [];

  return listEnemies(runtime).map((enemy) => {
    const ep = getEnemyPosition(runtime, enemy);
    if (!ep) return null;
    const enemyPos = ignoreY ? toVec3(runtime, { x: ep.x, y: 0, z: ep.z }) : ep.clone();

    const rel = enemyPos.sub(rayOrigin);
    const along = rel.dot(rayDir);
    if (along < 0 || along > range) return null;

    const proj = rayDir.clone().multiplyScalar(along);
    const perpSq = rel.sub(proj).lengthSq();
    if (perpSq > widthSq) return null;

    return {
      enemy,
      t: along,
      distToLine: Math.sqrt(perpSq),
      point: o.clone().add(rayDir.clone().multiplyScalar(along)),
    };
  }).filter(Boolean);
}

export function queryEnemiesInRadius(runtime, center, opts = {}) {
  const c = toVec3(runtime, center);
  const radius = Math.max(0, opts.radius ?? 8);
  const sortBy = opts.sortBy ?? 'distance';
  const out = listEnemies(runtime).filter((enemy) => enemyDistanceTo(runtime, enemy, c) <= radius);
  sortEnemies(runtime, out, c, sortBy);
  return applyLimit(out, opts.max);
}

export function queryEnemiesInCone(runtime, origin, direction, opts = {}) {
  const o = toVec3(runtime, origin);
  const dir = normalizeDirection(runtime, direction);
  const range = Math.max(0, opts.range ?? 12);
  const angleDeg = clamp(opts.angleDeg ?? 22, 0.1, 180);
  const cosThresh = Math.cos(runtime.THREE.MathUtils.degToRad(angleDeg));

  let out;
  if (typeof runtime?.baseFindEnemiesInCone === 'function') {
    out = runtime.baseFindEnemiesInCone(o, dir, { range, angleDeg }) || [];
  } else {
    out = listEnemies(runtime).filter((enemy) => {
      const ep = getEnemyPosition(runtime, enemy);
      if (!ep) return false;
      const delta = ep.sub(o);
      const d = delta.length();
      if (d <= 0.0001 || d > range) return false;
      delta.normalize();
      return dir.dot(delta) >= cosThresh;
    });
  }

  out = Array.isArray(out) ? out.slice() : [];
  sortEnemies(runtime, out, o, opts.sortBy ?? 'distance');
  return applyLimit(out, opts.max);
}

export function queryEnemiesInLine(runtime, origin, direction, opts = {}) {
  return queryLineHits(runtime, origin, direction, opts).map((hit) => hit.enemy);
}

export function queryLineHits(runtime, origin, direction, opts = {}) {
  const hasIgnoreY = Object.prototype.hasOwnProperty.call(opts, 'ignoreY');
  const firstPassIgnoreY = hasIgnoreY ? !!opts.ignoreY : false;

  let out = computeLineHits(runtime, origin, direction, opts, firstPassIgnoreY);
  if (!out.length && !hasIgnoreY) {
    // Fallback for elevated beam origins against ground enemies.
    out = computeLineHits(runtime, origin, direction, opts, true);
  }

  sortLineHits(out, opts.sortBy ?? 'along');
  return applyLimit(out, opts.max);
}

export function createTargetingHelpers(runtime) {
  return {
    findEnemiesInRadius: (center, opts = {}) => queryEnemiesInRadius(runtime, center, opts),

    findClosestEnemy: (point, opts = {}) => {
      const maxRange = opts.maxRange ?? Infinity;
      const hits = queryEnemiesInRadius(runtime, point, { radius: maxRange, max: 1, sortBy: 'distance' });
      return hits[0] || null;
    },

    findChainTargets: (startEnemyOrPoint, opts = {}) => {
      const jumpRadius = Math.max(0.001, opts.jumpRadius ?? 8);
      const maxJumps = Math.max(0, Math.floor(opts.maxJumps ?? 4));
      const fromDir = opts.fromDirection ? normalizeDirection(runtime, opts.fromDirection) : null;
      const all = listEnemies(runtime);
      const visited = new Set();
      const chain = [];

      const startLooksLikeEnemy = !!(startEnemyOrPoint && (startEnemyOrPoint.mesh || startEnemyOrPoint.position));
      let currentPoint = startLooksLikeEnemy
        ? getEnemyPosition(runtime, startEnemyOrPoint)
        : toVec3(runtime, startEnemyOrPoint);

      if (!currentPoint) return chain;

      if (startLooksLikeEnemy) {
        chain.push(startEnemyOrPoint);
        visited.add(enemyKey(startEnemyOrPoint));
      }

      while (chain.length < maxJumps) {
        let best = null;
        let bestDist = Infinity;

        for (const enemy of all) {
          const key = enemyKey(enemy);
          if (visited.has(key)) continue;
          const ep = getEnemyPosition(runtime, enemy);
          if (!ep) continue;
          const delta = ep.clone().sub(currentPoint);
          const d = delta.length();
          if (d <= 0.0001 || d > jumpRadius) continue;

          if (!chain.length && fromDir) {
            delta.normalize();
            if (delta.dot(fromDir) <= 0.05) continue;
          }

          if (d < bestDist) {
            best = enemy;
            bestDist = d;
          }
        }

        if (!best) break;
        chain.push(best);
        visited.add(enemyKey(best));
        currentPoint = getEnemyPosition(runtime, best) || currentPoint;
      }

      return chain;
    },

    findLineHits: (origin, direction, opts = {}) => queryLineHits(runtime, origin, direction, opts),
    findEnemiesInLine: (origin, direction, opts = {}) => queryEnemiesInLine(runtime, origin, direction, opts),
  };
}
