// src/avatarBuilder.js — Applies AI-generated avatar config to Three.js humanoid
import * as THREE from 'three';

let _currentConfig = null;
let _particlePool = null;

export function setAvatarParticlePool(pool) { _particlePool = pool; }
export function getAvatarConfig() { return _currentConfig; }
export function getAvatarConcept() { return _currentConfig?.name || ''; }

/**
 * Apply an AI-generated avatar config to the player's voxel humanoid.
 * Modifies colors, proportions, and adds accessories.
 */
export function applyAvatarConfig(playerMesh, config) {
  _currentConfig = config;
  const rig = playerMesh.userData?.rig;
  if (!rig) return;

  const { colors, proportions, accessories, effects } = config;

  // 1. Recolor body parts
  if (rig.body?.material) {
    rig.body.material.color.set(colors.primary);
    rig.body.material.emissive.set(colors.glow);
    rig.body.material.emissiveIntensity = 0.08;
  }
  if (rig.head?.material) {
    rig.head.material.color.set(colors.secondary);
  }
  if (rig.visor?.material) {
    rig.visor.material.color.set(colors.visor);
    rig.visor.material.emissive.set(colors.visor);
    rig.visor.material.emissiveIntensity = 0.3;
  }

  // Color arms and legs via their pivot children
  const colorPivotChildren = (pivot, color) => {
    if (!pivot) return;
    pivot.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.color.set(color);
      }
    });
  };
  colorPivotChildren(rig.leftArmPivot, colors.accent);
  colorPivotChildren(rig.rightArmPivot, colors.accent);
  colorPivotChildren(rig.leftLegPivot, colors.secondary);
  colorPivotChildren(rig.rightLegPivot, colors.secondary);

  // 2. Apply proportions
  if (proportions.headScale && rig.headPivot) {
    rig.headPivot.scale.setScalar(THREE.MathUtils.clamp(proportions.headScale, 0.7, 1.5));
  }
  if (proportions.bodyWidth && rig.body) {
    rig.body.scale.x = THREE.MathUtils.clamp(proportions.bodyWidth, 0.8, 1.4);
  }
  if (proportions.bulk) {
    playerMesh.scale.setScalar(THREE.MathUtils.clamp(proportions.bulk, 0.7, 1.5));
  }

  // 3. Add accessories
  // Clear old accessories
  const oldAccessories = playerMesh.userData.accessories || [];
  for (const acc of oldAccessories) {
    rig.root.remove(acc);
    acc.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  }
  playerMesh.userData.accessories = [];

  for (const acc of accessories) {
    const mesh = createAccessory(acc);
    if (mesh) {
      rig.root.add(mesh);
      playerMesh.userData.accessories.push(mesh);
    }
  }

  // 4. Store effects for game loop
  playerMesh.userData.avatarEffects = effects;
  playerMesh.userData.avatarColors = colors;
}

function createAccessory(acc) {
  const scale = THREE.MathUtils.clamp(acc.scale || 1, 0.5, 2);
  const mat = new THREE.MeshStandardMaterial({
    color: acc.color || '#ffffff',
    flatShading: true,
    roughness: 0.5,
    metalness: 0.3,
  });

  let group;
  switch (acc.type) {
    case 'horns': {
      group = new THREE.Group();
      const horn1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat);
      horn1.position.set(-0.15, 1.15, 0);
      horn1.rotation.z = 0.3;
      group.add(horn1);
      const horn2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat);
      horn2.position.set(0.15, 1.15, 0);
      horn2.rotation.z = -0.3;
      group.add(horn2);
      break;
    }
    case 'shoulder_pads': {
      group = new THREE.Group();
      const pad1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.25), mat);
      pad1.position.set(-0.5, 0.78, 0);
      group.add(pad1);
      const pad2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.25), mat);
      pad2.position.set(0.5, 0.78, 0);
      group.add(pad2);
      break;
    }
    case 'spikes': {
      group = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const spike = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), mat);
        spike.position.set((i - 1.5) * 0.15, 0.85, -0.2);
        spike.rotation.x = -0.3;
        group.add(spike);
      }
      break;
    }
    case 'crown': {
      group = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const point = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), mat);
        point.position.set(Math.cos(angle) * 0.18, 1.22, Math.sin(angle) * 0.18);
        group.add(point);
      }
      break;
    }
    case 'wings': {
      group = new THREE.Group();
      const wing1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.04), mat);
      wing1.position.set(-0.55, 0.65, 0.2);
      wing1.rotation.y = 0.4;
      wing1.rotation.z = 0.2;
      group.add(wing1);
      const wing2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.04), mat);
      wing2.position.set(0.55, 0.65, 0.2);
      wing2.rotation.y = -0.4;
      wing2.rotation.z = -0.2;
      group.add(wing2);
      break;
    }
    default:
      return null;
  }

  if (group) group.scale.setScalar(scale);
  return group;
}

/**
 * Update avatar effects each frame (aura particles, idle animation).
 */
export function updateAvatarEffects(playerMesh, dt) {
  const effects = playerMesh.userData?.avatarEffects;
  if (!effects) return;

  // Aura particles
  if (effects.auraParticles && _particlePool) {
    if (!playerMesh.userData._auraTimer) playerMesh.userData._auraTimer = 0;
    playerMesh.userData._auraTimer += dt;
    if (playerMesh.userData._auraTimer > 0.15) {
      playerMesh.userData._auraTimer = 0;
      const pos = playerMesh.position.clone();
      pos.x += (Math.random() - 0.5) * 0.8;
      pos.y += Math.random() * 1.5;
      pos.z += (Math.random() - 0.5) * 0.8;
      _particlePool.burst({
        position: pos,
        color: effects.auraColor || '#ffffff',
        count: 1,
        speed: 1.5,
        lifetime: 0.6,
        size: 2,
        gravity: -0.5, // float upward
      });
    }
  }
}

/**
 * Reset avatar to default state (on restart).
 */
export function resetAvatar(playerMesh) {
  const oldAccessories = playerMesh.userData.accessories || [];
  for (const acc of oldAccessories) {
    const rig = playerMesh.userData?.rig;
    if (rig?.root) rig.root.remove(acc);
  }
  playerMesh.userData.accessories = [];
  playerMesh.userData.avatarEffects = null;
  playerMesh.userData.damageEmitters = null;
}
