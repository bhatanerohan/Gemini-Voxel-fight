import * as THREE from 'three';

const COOP_PALETTES = [
  { suitColor: 0x00a6ff, accentColor: 0xa8ecff, emissive: 0x003c66, visorColor: 0x0f2233 },
  { suitColor: 0x32c25b, accentColor: 0xb3ffd1, emissive: 0x0f4c28, visorColor: 0x102d17 },
  { suitColor: 0xff9d1f, accentColor: 0xffd08a, emissive: 0x5d2c00, visorColor: 0x302010 },
  { suitColor: 0xf44f93, accentColor: 0xffbbd6, emissive: 0x5e1737, visorColor: 0x30131d },
  { suitColor: 0x8b77ff, accentColor: 0xd2cbff, emissive: 0x30285f, visorColor: 0x171631 },
];


const TEAM_PALETTES = {
  blue: { suitColor: 0x2f7dff, accentColor: 0x9fe1ff, emissive: 0x1144aa, visorColor: 0x0a2038 },
  red: { suitColor: 0xff4d5c, accentColor: 0xffb0b7, emissive: 0x7a1824, visorColor: 0x2f0f14 },
};


export function createVoxelHumanoid({
  suitColor = 0x3a7cff,
  accentColor = 0x88d6ff,
  skinColor = 0xf3c7a2,
  emissive = 0x000000,
  emissiveIntensity = 0,
  visorColor = 0x112233,
  showMuzzleGauntlet = false,
} = {}) {
  const group = new THREE.Group();
  const rigRoot = new THREE.Group();
  group.add(rigRoot);

  const suitMat = new THREE.MeshStandardMaterial({
    color: suitColor,
    emissive,
    emissiveIntensity,
    roughness: 0.48,
    metalness: 0.12,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive,
    emissiveIntensity: emissiveIntensity * 0.5,
    roughness: 0.4,
    metalness: 0.08,
    flatShading: true,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.7,
    metalness: 0.02,
    flatShading: true,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: visorColor,
    emissive: 0x111a22,
    emissiveIntensity: 0.16,
    roughness: 0.2,
    metalness: 0.55,
    flatShading: true,
  });

  const addPart = (parent, geo, mat, x, y, z) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const armSize = { x: 0.2, y: 0.62, z: 0.22 };
  const legSize = { x: 0.26, y: 0.62, z: 0.26 };

  const bodyMesh = addPart(rigRoot, new THREE.BoxGeometry(0.64, 0.72, 0.34), suitMat, 0, 0.4, 0);
  addPart(rigRoot, new THREE.BoxGeometry(0.42, 0.26, 0.36), accentMat, 0, 0.5, -0.02);
  addPart(rigRoot, new THREE.BoxGeometry(0.32, 0.36, 0.16), accentMat, 0, 0.42, 0.25);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.79, 0);
  rigRoot.add(headPivot);
  const head = addPart(headPivot, new THREE.BoxGeometry(0.48, 0.48, 0.48), skinMat, 0, 0.24, 0);
  addPart(headPivot, new THREE.BoxGeometry(0.52, 0.12, 0.52), accentMat, 0, 0.53, 0);
  const visor = addPart(headPivot, new THREE.BoxGeometry(0.28, 0.12, 0.08), visorMat, 0, 0.27, -0.25);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.44, 0.68, 0);
  rigRoot.add(leftArmPivot);
  addPart(leftArmPivot, new THREE.BoxGeometry(armSize.x, armSize.y, armSize.z), suitMat, 0, -armSize.y * 0.5, 0);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.44, 0.68, 0);
  rigRoot.add(rightArmPivot);
  addPart(rightArmPivot, new THREE.BoxGeometry(armSize.x, armSize.y, armSize.z), suitMat, 0, -armSize.y * 0.5, 0);

  let muzzleTip = null;
  if (showMuzzleGauntlet) {
    const gauntletRoot = new THREE.Group();
    gauntletRoot.position.set(0.04, -armSize.y + 0.05, -0.04);
    rightArmPivot.add(gauntletRoot);

    addPart(gauntletRoot, new THREE.BoxGeometry(0.42, 0.5, 0.56), suitMat, 0, -0.02, 0.04);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.28, 0.16, 0.36), accentMat, 0, 0.12, 0.07);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.14, 0.4, 0.22), accentMat, -0.2, -0.02, -0.02);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.14, 0.4, 0.22), accentMat, 0.2, -0.02, -0.02);
    addPart(gauntletRoot, new THREE.BoxGeometry(0.18, 0.1, 0.38), accentMat, 0, -0.2, 0.04);

    const barrelSegments = [
      { radius: 0.23, length: 0.14, z: -0.1 },
      { radius: 0.205, length: 0.13, z: -0.22 },
      { radius: 0.18, length: 0.12, z: -0.33 },
      { radius: 0.155, length: 0.11, z: -0.43 },
    ];
    for (const segment of barrelSegments) {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(segment.radius * 0.92, segment.radius, segment.length, 12, 1, false),
        suitMat,
      );
      shell.rotation.x = Math.PI / 2;
      shell.position.set(0, -0.02, segment.z);
      shell.castShadow = true;
      shell.receiveShadow = true;
      gauntletRoot.add(shell);
    }

    const barrelCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.094, 0.54, 12),
      visorMat,
    );
    barrelCore.rotation.x = Math.PI / 2;
    barrelCore.position.set(0, -0.02, -0.28);
    barrelCore.castShadow = true;
    barrelCore.receiveShadow = true;
    gauntletRoot.add(barrelCore);

    const muzzleRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.175, 0.08, 12, 1, true),
      accentMat,
    );
    muzzleRing.rotation.x = Math.PI / 2;
    muzzleRing.position.set(0, -0.02, -0.5);
    muzzleRing.castShadow = true;
    muzzleRing.receiveShadow = true;
    gauntletRoot.add(muzzleRing);

    const muzzleCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.045, 12),
      visorMat,
    );
    muzzleCap.rotation.x = Math.PI / 2;
    muzzleCap.position.set(0, -0.02, -0.54);
    muzzleCap.castShadow = true;
    muzzleCap.receiveShadow = true;
    gauntletRoot.add(muzzleCap);

    muzzleTip = new THREE.Group();
    muzzleTip.position.set(0, -0.02, -0.57);
    gauntletRoot.add(muzzleTip);
  }

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.16, 0.02, 0);
  rigRoot.add(leftLegPivot);
  addPart(leftLegPivot, new THREE.BoxGeometry(legSize.x, legSize.y, legSize.z), suitMat, 0, -legSize.y * 0.5, 0);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.16, 0.02, 0);
  rigRoot.add(rightLegPivot);
  addPart(rightLegPivot, new THREE.BoxGeometry(legSize.x, legSize.y, legSize.z), suitMat, 0, -legSize.y * 0.5, 0);

  const rig = {
    root: rigRoot,
    body: bodyMesh,
    headPivot,
    head,
    visor,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    hasMuzzleGauntlet: showMuzzleGauntlet,
    muzzleTip,
    phase: Math.random() * Math.PI * 2,
    speed: 0,
    swing: 0,
    bob: 0,
  };

  group.userData.rig = rig;
  group.userData.materials = { suitMat, accentMat, skinMat, visorMat };
  return { group, bodyMesh, rig };
}

export function animateHumanoid(
  mesh,
  dt,
  horizontalSpeed = 0,
  { frozen = false, localForward = 0, localRight = 0, aimPitch = 0 } = {},
) {
  const rig = mesh?.userData?.rig;
  if (!rig) return;

  const speedNorm = frozen ? 0 : THREE.MathUtils.clamp(horizontalSpeed / 16, 0, 1.4);
  const blendIn = Math.min(1, dt * 10);
  rig.speed = THREE.MathUtils.lerp(rig.speed, speedNorm, blendIn);

  rig.phase += dt * THREE.MathUtils.lerp(3.5, 11, Math.min(1, rig.speed));

  const moving = rig.speed > 0.05;
  const localMoveMag = Math.abs(localForward) + Math.abs(localRight);
  const forwardMix = localMoveMag > 0.001 ? Math.abs(localForward) / localMoveMag : 1;
  const strafeMix = localMoveMag > 0.001 ? Math.abs(localRight) / localMoveMag : 0;
  const strideSign = localForward < -0.05 ? -1 : 1;
  const strafeSign = Math.sign(localRight);
  const stride = moving ? THREE.MathUtils.lerp(0.12, 0.8, Math.min(1, rig.speed)) : 0;
  const targetSwing = Math.sin(rig.phase) * stride * strideSign;
  const targetBob = moving ? Math.max(0, Math.sin(rig.phase * 2)) * 0.065 * rig.speed : 0;
  const lean = moving ? -strafeSign * 0.12 * strafeMix : 0;
  const legSpread = moving ? 0.1 * strafeMix : 0;

  rig.swing = THREE.MathUtils.lerp(rig.swing, targetSwing, Math.min(1, dt * 12));
  rig.bob = THREE.MathUtils.lerp(rig.bob, targetBob, Math.min(1, dt * 12));

  rig.leftArmPivot.rotation.x = rig.swing * 0.9;
  if (rig.hasMuzzleGauntlet) {
    const rightArmBaseX = 1.34;
    const rightArmSwing = moving ? -rig.swing * 0.18 * (0.45 + 0.55 * forwardMix) : 0;
    rig.rightArmPivot.rotation.x = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.x,
      rightArmBaseX + aimPitch + rightArmSwing,
      Math.min(1, dt * 12),
    );
    rig.rightArmPivot.rotation.y = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.y,
      -0.06,
      Math.min(1, dt * 10),
    );
    rig.rightArmPivot.rotation.z = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.z,
      -0.18 - 0.025 * strafeSign * strafeMix,
      Math.min(1, dt * 10),
    );
  } else {
    rig.rightArmPivot.rotation.x = -rig.swing * 0.9;
    rig.rightArmPivot.rotation.y = THREE.MathUtils.lerp(rig.rightArmPivot.rotation.y, 0, Math.min(1, dt * 10));
    rig.rightArmPivot.rotation.z = THREE.MathUtils.lerp(
      rig.rightArmPivot.rotation.z,
      -0.08 * strafeSign * strafeMix,
      Math.min(1, dt * 10),
    );
  }
  rig.leftArmPivot.rotation.z = THREE.MathUtils.lerp(
    rig.leftArmPivot.rotation.z,
    -0.08 * strafeSign * strafeMix,
    Math.min(1, dt * 10),
  );
  rig.leftLegPivot.rotation.x = -rig.swing * 1.1;
  rig.rightLegPivot.rotation.x = rig.swing * 1.1;
  rig.leftLegPivot.rotation.z = THREE.MathUtils.lerp(rig.leftLegPivot.rotation.z, legSpread, Math.min(1, dt * 10));
  rig.rightLegPivot.rotation.z = THREE.MathUtils.lerp(rig.rightLegPivot.rotation.z, -legSpread, Math.min(1, dt * 10));

  const torsoTwist = moving ? Math.sin(rig.phase) * 0.08 * rig.speed * (0.5 + 0.5 * forwardMix) : 0;
  rig.body.rotation.y = torsoTwist;
  rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, lean, Math.min(1, dt * 10));
  rig.headPivot.rotation.y = -torsoTwist * 0.55;
  rig.headPivot.rotation.x = moving ? Math.sin(rig.phase * 2) * 0.03 * rig.speed : 0;
  rig.root.position.y = rig.bob * 0.5;
  rig.head.position.y = 0.24 + rig.bob * 0.25;
  rig.visor.position.y = 0.27 + rig.bob * 0.12;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function getCoopPalette(peerId) {
  return COOP_PALETTES[hashString(peerId) % COOP_PALETTES.length];
}

export function getTeamPalette(teamId, peerId = '') {
  if (teamId && TEAM_PALETTES[teamId]) return TEAM_PALETTES[teamId];
  return getCoopPalette(peerId || 'neutral');
}

export function applyHumanoidPalette(mesh, palette = {}) {
  const materials = mesh?.userData?.materials;
  if (!materials) return;
  const { suitMat, accentMat, visorMat } = materials;
  if (palette.suitColor != null) suitMat.color.setHex(palette.suitColor);
  if (palette.accentColor != null) accentMat.color.setHex(palette.accentColor);
  if (palette.emissive != null) {
    suitMat.emissive.setHex(palette.emissive);
    accentMat.emissive.setHex(palette.emissive);
  }
  if (palette.emissiveIntensity != null) {
    suitMat.emissiveIntensity = palette.emissiveIntensity;
    accentMat.emissiveIntensity = palette.emissiveIntensity * 0.5;
  }
  if (palette.visorColor != null) visorMat.color.setHex(palette.visorColor);
}

export function formatWeaponLabel(name) {
  const value = String(name || 'No Weapon').trim();
  if (!value) return 'No Weapon';
  return value.length > 20 ? `${value.slice(0, 20)}...` : value;
}



