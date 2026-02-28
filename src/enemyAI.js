// src/enemyAI.js — Type-specific enemy AI behaviors
import * as THREE from 'three';

const _tempVec = new THREE.Vector3();

/**
 * Update a single enemy's AI based on its type.
 * Called from updateEnemies() in main.js for each alive, non-frozen, non-stunned enemy.
 * Modifies enemy velocity. Does NOT handle position integration, status effects, or animation.
 *
 * @param {object} e - enemy object with pos, vel, type, typeConfig, etc.
 * @param {object} player - player object with pos
 * @param {object[]} allEnemies - all enemy objects
 * @param {number} dt - delta time
 * @param {number} slowScale - slow multiplier (1.0 = normal)
 */
export function updateEnemyAI(e, player, allEnemies, dt, slowScale = 1) {
  if (e.isChampion) return championAI(e, player, allEnemies, dt, slowScale);
  const type = e.typeConfig?.name || 'Grunt';

  switch (type) {
    case 'Charger': return chargerAI(e, player, allEnemies, dt, slowScale);
    case 'Tank': return tankAI(e, player, allEnemies, dt, slowScale);
    case 'Ranged': return rangedAI(e, player, allEnemies, dt, slowScale);
    default: return gruntAI(e, player, allEnemies, dt, slowScale);
  }
}

function getChampionPhase(e) {
  const hpRatio = e.maxHp > 0 ? (e.hp / e.maxHp) : 1;
  if (hpRatio > 0.66) return 'phase1';
  if (hpRatio > 0.33) return 'phase2';
  return 'phase3';
}

function championAI(e, player, allEnemies, dt, slowScale) {
  const state = e.championState || (e.championState = {});
  const profile = state.profile || {};
  const aggression = THREE.MathUtils.clamp(profile.aggression ?? 0.5, 0, 1);
  const strafeBias = THREE.MathUtils.clamp(profile.strafeBias ?? 0.25, 0, 1);
  const sprintBias = THREE.MathUtils.clamp(profile.sprintBias ?? 0.2, 0, 1);
  const closeRangeBias = THREE.MathUtils.clamp(profile.closeRangeBias ?? 0.3, 0, 1);
  const longRangeBias = THREE.MathUtils.clamp(profile.longRangeBias ?? 0.35, 0, 1);
  const prefersLongRange = longRangeBias > closeRangeBias + 0.1;

  state.burstCooldown = Number.isFinite(state.burstCooldown) ? state.burstCooldown : 0;
  state.burstCooldown -= dt;
  state.phase = getChampionPhase(e);

  const leadTimeBase = THREE.MathUtils.lerp(0.12, 0.45, strafeBias);
  const leadTime = state.phase === 'phase3' ? leadTimeBase + 0.12 : leadTimeBase;
  _tempVec.copy(player.pos);
  if (player.vel) _tempVec.addScaledVector(player.vel, leadTime);
  let dx = _tempVec.x - e.pos.x;
  let dz = _tempVec.z - e.pos.z;
  let dist = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
  const nx = dx / dist;
  const nz = dz / dist;

  let pursuit = 13 + aggression * 5;
  if (state.phase === 'phase2') pursuit += 3;
  if (state.phase === 'phase3') pursuit += 7;
  pursuit *= slowScale;

  if (prefersLongRange && dist < 8) {
    e.vel.x -= nx * pursuit * 0.7 * dt;
    e.vel.z -= nz * pursuit * 0.7 * dt;
  } else if (dist > 2.6) {
    e.vel.x += nx * pursuit * dt;
    e.vel.z += nz * pursuit * dt;
  }

  if (strafeBias > 0.28 && dist < 20) {
    const sideX = -nz;
    const sideZ = nx;
    const strafeDir = Math.sign((player.vel?.x || 0) * sideX + (player.vel?.z || 0) * sideZ) || 1;
    const strafeForce = (5 + strafeBias * 12) * slowScale;
    e.vel.x += sideX * strafeDir * strafeForce * dt;
    e.vel.z += sideZ * strafeDir * strafeForce * dt;
  }

  if (state.phase !== 'phase1' && state.burstCooldown <= 0 && dist > 4 && dist < 26) {
    const burst = state.phase === 'phase3' ? 36 : 28;
    e.vel.x += nx * burst * slowScale;
    e.vel.z += nz * burst * slowScale;
    state.burstCooldown = THREE.MathUtils.lerp(2.6, 1.3, Math.max(sprintBias, aggression));
  }

  const damageScale = state.phase === 'phase1' ? 1.15 : state.phase === 'phase2' ? 1.38 : 1.72;
  const cooldownScale = state.phase === 'phase1' ? 0.95 : state.phase === 'phase2' ? 0.72 : 0.55;
  const attackRange = prefersLongRange
    ? (state.phase === 'phase3' ? 3.8 : 3.2)
    : (state.phase === 'phase3' ? 4.4 : 3.6);
  e.championCombat = { damageScale, cooldownScale, attackRange, phase: state.phase };

  applySeparation(e, allEnemies, dt, slowScale * 0.6);
}

function distToPlayer(e, player) {
  const dx = player.pos.x - e.pos.x;
  const dz = player.pos.z - e.pos.z;
  return { dx, dz, dist: Math.sqrt(dx * dx + dz * dz) };
}

function applySeparation(e, allEnemies, dt, slowScale) {
  for (const o of allEnemies) {
    if (o === e || o.alive === false) continue;
    const ox = e.pos.x - o.pos.x;
    const oz = e.pos.z - o.pos.z;
    const odSq = ox * ox + oz * oz;
    if (odSq < 25 && odSq > 0.01) {
      const od = Math.sqrt(odSq);
      e.vel.x += (ox / od) * 10 * slowScale * dt;
      e.vel.z += (oz / od) * 10 * slowScale * dt;
    }
  }
}

// ── GRUNT: Basic melee, walks toward player ──
function gruntAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);

  if (dist > 10 && dist < 60) {
    e.vel.x += (dx / dist) * 15 * slowScale * dt;
    e.vel.z += (dz / dist) * 15 * slowScale * dt;
  } else if (dist < 6 && dist > 0.1) {
    e.vel.x -= (dx / dist) * 12 * slowScale * dt;
    e.vel.z -= (dz / dist) * 12 * slowScale * dt;
  }

  applySeparation(e, allEnemies, dt, slowScale);
}

// ── CHARGER: Walk normally, dash when in range ──
function chargerAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);

  // Initialize dash state
  if (e.dashState === undefined) {
    e.dashState = { cooldown: 2, dashing: false, dashTime: 0, dashDirX: 0, dashDirZ: 0 };
  }
  const ds = e.dashState;

  if (ds.dashing) {
    // During dash: move fast in stored direction
    ds.dashTime -= dt;
    e.vel.x = ds.dashDirX * 30;
    e.vel.z = ds.dashDirZ * 30;
    if (ds.dashTime <= 0) {
      ds.dashing = false;
      ds.cooldown = 4;
    }
    return; // skip separation during dash
  }

  ds.cooldown -= dt;

  // Trigger dash when in range and cooldown ready
  if (ds.cooldown <= 0 && dist > 4 && dist < 12) {
    ds.dashing = true;
    ds.dashTime = 0.4;
    ds.dashDirX = dx / dist;
    ds.dashDirZ = dz / dist;
    return;
  }

  // Normal movement: approach player
  if (dist > 6 && dist < 60) {
    e.vel.x += (dx / dist) * 18 * slowScale * dt;
    e.vel.z += (dz / dist) * 18 * slowScale * dt;
  }

  applySeparation(e, allEnemies, dt, slowScale);
}

// ── TANK: Slow, steady advance ──
function tankAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);

  // Always advance toward player, slower but relentless
  if (dist > 3 && dist < 60) {
    e.vel.x += (dx / dist) * 8 * slowScale * dt;
    e.vel.z += (dz / dist) * 8 * slowScale * dt;
  }

  applySeparation(e, allEnemies, dt, slowScale);
}

// ── RANGED: Keep distance, strafe, shoot projectiles ──
function rangedAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);
  const preferredRange = 15;
  const fleeRange = 6;

  if (dist < fleeRange && dist > 0.1) {
    // Too close, back away
    e.vel.x -= (dx / dist) * 20 * slowScale * dt;
    e.vel.z -= (dz / dist) * 20 * slowScale * dt;
  } else if (dist > preferredRange + 5 && dist < 60) {
    // Too far, approach
    e.vel.x += (dx / dist) * 12 * slowScale * dt;
    e.vel.z += (dz / dist) * 12 * slowScale * dt;
  } else if (dist >= fleeRange && dist <= preferredRange + 5) {
    // At preferred range: strafe sideways
    const strafeX = -dz / dist;
    const strafeZ = dx / dist;
    const strafeDir = ((e.strafeDir ?? 1));
    e.vel.x += strafeX * 8 * strafeDir * slowScale * dt;
    e.vel.z += strafeZ * 8 * strafeDir * slowScale * dt;

    // Change strafe direction periodically
    e.strafeTimer = (e.strafeTimer ?? 3) - dt;
    if (e.strafeTimer <= 0) {
      e.strafeDir = -(e.strafeDir ?? 1);
      e.strafeTimer = 2 + Math.random() * 2;
    }
  }

  applySeparation(e, allEnemies, dt, slowScale);
}
