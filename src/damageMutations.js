// src/damageMutations.js — Applies damage mutation configs to the player humanoid
import * as THREE from 'three';

let _appliedThresholds = new Set();
let _particlePool = null;

export function setDamageParticlePool(pool) { _particlePool = pool; }

/**
 * Apply a damage mutation to the player mesh.
 * Mutations are additive — each threshold adds to previous damage.
 */
export function applyDamageMutation(playerMesh, mutation) {
  if (!mutation) return;
  const rig = playerMesh.userData?.rig;
  if (!rig) return;

  // Color shifts
  if (mutation.colorShifts) {
    for (const shift of mutation.colorShifts) {
      const mesh = getPartMesh(rig, shift.part);
      if (mesh?.material) {
        mesh.material.color.lerp(new THREE.Color(shift.newColor), 0.7);
      }
    }
  }

  // Remove parts (hide, don't destroy — needed for reset)
  if (mutation.removeParts) {
    for (const part of mutation.removeParts) {
      const pivot = getPartPivot(rig, part);
      if (pivot) pivot.visible = false;
    }
  }

  // Add particle effects
  if (mutation.addEffects) {
    if (!playerMesh.userData.damageEmitters) playerMesh.userData.damageEmitters = [];
    for (const effect of mutation.addEffects) {
      playerMesh.userData.damageEmitters.push({
        type: effect.type,
        color: effect.color || '#ff4400',
        intensity: THREE.MathUtils.clamp(effect.intensity || 1, 0.5, 3),
        timer: 0,
      });
    }
  }

  // Scale changes
  if (mutation.scaleChanges) {
    for (const sc of mutation.scaleChanges) {
      const pivot = getPartPivot(rig, sc.part);
      if (pivot) {
        pivot.scale.setScalar(THREE.MathUtils.clamp(sc.scale, 0.5, 2));
      }
    }
  }
}

/**
 * Called each frame to emit persistent damage particles.
 */
export function updateDamageEffects(playerMesh, dt) {
  const emitters = playerMesh.userData?.damageEmitters;
  if (!emitters || !_particlePool) return;

  for (const emitter of emitters) {
    emitter.timer += dt;
    const interval = 0.15 / emitter.intensity;
    if (emitter.timer > interval) {
      emitter.timer = 0;
      const pos = playerMesh.position.clone();
      pos.x += (Math.random() - 0.5) * 0.5;
      pos.y += Math.random() * 1.5;
      pos.z += (Math.random() - 0.5) * 0.5;

      let speed = 3, gravity = 0.5, size = 2;
      switch (emitter.type) {
        case 'fire': speed = 4; gravity = -0.5; break;
        case 'sparks': speed = 6; gravity = 1; size = 1.5; break;
        case 'smoke': speed = 1.5; gravity = -0.3; size = 3; break;
        case 'glitch': speed = 8; gravity = 0; size = 1; break;
        case 'drip': speed = 1; gravity = 2; break;
        case 'crack_glow': speed = 2; gravity = -0.2; break;
      }

      _particlePool.burst({
        position: pos,
        color: emitter.color,
        count: 1,
        speed,
        lifetime: 0.4,
        size,
        gravity,
      });
    }
  }
}

/**
 * Check if we should trigger a mutation at the current health level.
 * Returns the threshold if a new one was crossed, null otherwise.
 */
export function checkDamageThreshold(healthPercent) {
  const threshold = healthPercent <= 10 ? 10
    : healthPercent <= 25 ? 25
    : healthPercent <= 50 ? 50
    : healthPercent <= 75 ? 75 : null;

  if (!threshold || _appliedThresholds.has(threshold)) return null;
  _appliedThresholds.add(threshold);
  return threshold;
}

/**
 * Reset all damage mutations (on restart/respawn).
 */
export function clearDamageMutations(playerMesh) {
  _appliedThresholds.clear();
  if (playerMesh.userData) {
    playerMesh.userData.damageEmitters = [];
  }

  // Restore visibility of all parts
  const rig = playerMesh.userData?.rig;
  if (rig) {
    if (rig.leftArmPivot) rig.leftArmPivot.visible = true;
    if (rig.rightArmPivot) rig.rightArmPivot.visible = true;
    if (rig.leftLegPivot) rig.leftLegPivot.visible = true;
    if (rig.rightLegPivot) rig.rightLegPivot.visible = true;
    if (rig.headPivot) rig.headPivot.visible = true;
  }
}

function getPartMesh(rig, partName) {
  switch (partName) {
    case 'body': return rig.body;
    case 'head': return rig.head;
    case 'visor': return rig.visor;
    case 'arms': return rig.leftArmPivot?.children?.[0]; // first arm mesh
    case 'legs': return rig.leftLegPivot?.children?.[0]; // first leg mesh
    default: return null;
  }
}

function getPartPivot(rig, partName) {
  switch (partName) {
    case 'body': return rig.body;
    case 'head': case 'horns': case 'crown': return rig.headPivot;
    case 'left_arm': return rig.leftArmPivot;
    case 'right_arm': return rig.rightArmPivot;
    case 'left_leg': return rig.leftLegPivot;
    case 'right_leg': return rig.rightLegPivot;
    case 'arms': return rig.leftArmPivot; // affects left by default
    case 'legs': return rig.leftLegPivot;
    case 'shoulder_pad': case 'shoulder_pads': return rig.body;
    case 'wings': return rig.body;
    default: return null;
  }
}
