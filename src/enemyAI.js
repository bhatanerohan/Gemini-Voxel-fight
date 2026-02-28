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
  const type = e.typeConfig?.name || 'Grunt';

  switch (type) {
    case 'Charger': return chargerAI(e, player, allEnemies, dt, slowScale);
    case 'Tank': return tankAI(e, player, allEnemies, dt, slowScale);
    case 'Ranged': return rangedAI(e, player, allEnemies, dt, slowScale);
    default: return gruntAI(e, player, allEnemies, dt, slowScale);
  }
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
