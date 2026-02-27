import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import {
  initSandbox, updateEntities, updateTrails, updateSandboxTimers,
  updateParticles, fire, getShake, tickShake,
} from './sandbox.js';
import { initForge, openForge, closeForge, isForgeOpen } from './forge.js';

// ══════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════
let renderer, labelRenderer, scene, camera, composer;
let keys = {};
let mouseDown = false;
let playerYaw = 0;
let targetAimYaw = 0;
let playerAimPitch = 0;
let targetAimPitch = 0;
let aimYawDirty = true;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const aimMouseNdc = new THREE.Vector2(0, 0);
const aimRaycaster = new THREE.Raycaster();
const aimGroundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimHitPoint = new THREE.Vector3();
const cameraCollisionRay = new THREE.Raycaster();
const cameraCollisionMeshes = [];
const aimCollisionMeshes = [];
const cameraState = {
  initialized: false,
  position: new THREE.Vector3(),
  lookAt: new THREE.Vector3(),
};
const CAMERA_RIG = {
  pivotHeight: 1.45,
  shoulderRight: 1.15,
  shoulderUp: 0.82,
  shoulderForward: 0.2,
  distance: 6.1,
  followHeight: 0.42,
  lookHeight: 1.45,
  lookAhead: 11.5,
  positionSharpness: 9,
  lookSharpness: 11,
  collisionPadding: 0.35,
  minDistance: 2.1,
  aimDistance: 120,
};
const tempGroundHit = new THREE.Vector3();
const tempCameraForward = new THREE.Vector3();
const tempCameraRight = new THREE.Vector3();
const tempCameraPivot = new THREE.Vector3();
const tempCameraShoulder = new THREE.Vector3();
const tempCameraDesired = new THREE.Vector3();
const tempCameraLookAt = new THREE.Vector3();
const tempCameraRayDir = new THREE.Vector3();

// Slow-mo & screen flash
let slowMoTimer = 0;
let slowMoScale = 1;
let flashAlpha = 0;
const flashEl = () => document.getElementById('screen-flash');

const player = { pos: new THREE.Vector3(0, 0.6, 0), vel: new THREE.Vector3(), mesh: null };
const enemies = [];

function createVoxelHumanoid({
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
  return { group, bodyMesh, rig };
}

function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function dampFactor(sharpness, dt) {
  return 1 - Math.exp(-sharpness * dt);
}

function setCrosshairPosition(clientX, clientY) {
  const crosshair = document.getElementById('crosshair');
  if (!crosshair) return;
  crosshair.style.left = `${clientX}px`;
  crosshair.style.top = `${clientY}px`;
}

function syncCrosshairToAim() {
  const clientX = (aimMouseNdc.x * 0.5 + 0.5) * innerWidth;
  const clientY = (-aimMouseNdc.y * 0.5 + 0.5) * innerHeight;
  setCrosshairPosition(clientX, clientY);
}

function getPlayerShootOrigin() {
  const muzzleTip = player.mesh?.userData?.rig?.muzzleTip;
  if (muzzleTip && typeof muzzleTip.getWorldPosition === 'function') {
    return muzzleTip.getWorldPosition(new THREE.Vector3());
  }
  return player.pos.clone().add(new THREE.Vector3(0, 0.95, 0));
}

function getPlayerAimPoint() {
  const aimPoint = resolveAimPoint();
  return aimPoint ? aimPoint.clone() : null;
}

function updateAimFromMouseEvent(e) {
  aimMouseNdc.x = (e.clientX / innerWidth) * 2 - 1;
  aimMouseNdc.y = -(e.clientY / innerHeight) * 2 + 1;
  setCrosshairPosition(e.clientX, e.clientY);
  aimYawDirty = true;
}

function resolveAimPoint() {
  if (!camera) return null;

  aimRaycaster.setFromCamera(aimMouseNdc, camera);
  aimRaycaster.far = CAMERA_RIG.aimDistance;

  if (aimCollisionMeshes.length > 0) {
    const hits = aimRaycaster.intersectObjects(aimCollisionMeshes, false);
    if (hits.length > 0) {
      aimHitPoint.copy(hits[0].point);
      return aimHitPoint;
    }
  }

  if (aimRaycaster.ray.intersectPlane(aimGroundPlane, tempGroundHit)) {
    aimHitPoint.copy(tempGroundHit);
    return aimHitPoint;
  }

  aimHitPoint.copy(aimRaycaster.ray.origin).addScaledVector(aimRaycaster.ray.direction, CAMERA_RIG.aimDistance);
  return aimHitPoint;
}

function updateAimLocomotion(dt) {
  if (aimYawDirty) {
    const aimPoint = getPlayerAimPoint();
    if (aimPoint) {
      const dx = aimPoint.x - player.pos.x;
      const dz = aimPoint.z - player.pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq >= 0.04) {
        targetAimYaw = Math.atan2(-dx, -dz);
        const shootOrigin = getPlayerShootOrigin();
        const aimFromMuzzle = aimPoint.clone().sub(shootOrigin);
        const aimHorizontal = Math.hypot(aimFromMuzzle.x, aimFromMuzzle.z);
        if (aimHorizontal > 0.001 || Math.abs(aimFromMuzzle.y) > 0.001) {
          targetAimPitch = THREE.MathUtils.clamp(
            Math.atan2(aimFromMuzzle.y, Math.max(0.001, aimHorizontal)),
            -0.85,
            0.85,
          );
        }
        aimYawDirty = false;
      }
    }
  }

  playerYaw += angleDelta(playerYaw, targetAimYaw) * dampFactor(18, dt);
  playerAimPitch += (targetAimPitch - playerAimPitch) * dampFactor(18, dt);
}

function animateHumanoid(mesh, dt, horizontalSpeed = 0, { frozen = false, localForward = 0, localRight = 0 } = {}) {
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
      rightArmBaseX + playerAimPitch + rightArmSwing,
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
  rig.leftArmPivot.rotation.z = THREE.MathUtils.lerp(rig.leftArmPivot.rotation.z, -0.08 * strafeSign * strafeMix, Math.min(1, dt * 10));
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

// Expose slow-mo and flash for sandbox
export function triggerSlowMo(duration = 0.4, scale = 0.15) {
  slowMoTimer = duration;
  slowMoScale = scale;
}
export function triggerFlash(alpha = 0.3) {
  flashAlpha = alpha;
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  document.body.appendChild(renderer.domElement);

  // CSS2D Renderer for health bars
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(innerWidth, innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  labelRenderer.domElement.style.pointerEvents = 'none';
  document.body.appendChild(labelRenderer.domElement);

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060612);
  scene.fog = new THREE.FogExp2(0x060612, 0.011);

  // Camera
  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 500);

  // Bloom - reduced intensity for softer glow
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), 0.8, 0.3, 0.3
    );
    composer.addPass(bloom);
  } catch (e) {
    console.warn('Bloom not available:', e);
    composer = null;
  }

  // Lights
  scene.add(new THREE.AmbientLight(0x223344, 0.6));
  const sun = new THREE.DirectionalLight(0xffeedd, 1.0);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -60;
  sc.right = sc.top = 60;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x4488ff, 0x221111, 0.3));

  // Ground
  const gnd = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x0e0e1a, roughness: 0.9, metalness: 0.1 })
  );
  gnd.rotation.x = -Math.PI / 2;
  gnd.receiveShadow = true;
  scene.add(gnd);

  // Grid
  const grid = new THREE.GridHelper(200, 100, 0x1a1a44, 0x111128);
  grid.position.y = 0.02;
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  // Arena boundary — glowing neon strips
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x0088ff, emissive: 0x003388, emissiveIntensity: 0.7,
    roughness: 0.2, metalness: 0.8,
  });
  [[0, 0.15, -50.2, 100, 0.3, 0.4], [0, 0.15, 50.2, 100, 0.3, 0.4],
   [-50.2, 0.15, 0, 0.4, 0.3, 100], [50.2, 0.15, 0, 0.4, 0.3, 100]].forEach(([x,y,z,sx,sy,sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), stripMat);
    m.position.set(x, y, z);
    scene.add(m);
  });

  // Walls (invisible collision — visual is the glow strip)
  const wm = new THREE.MeshStandardMaterial({ color: 0x151530, roughness: 0.7, transparent: true, opacity: 0.4 });
  [[0, -50, 100, 4, 1], [0, 50, 100, 4, 1], [-50, 0, 1, 4, 100], [50, 0, 1, 4, 100]].forEach(([x, z, sx, sy, sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wm);
    m.position.set(x, sy / 2, z);
    scene.add(m);
    cameraCollisionMeshes.push(m);
    aimCollisionMeshes.push(m);
  });

  // Obstacles — darker, more dramatic
  const om = new THREE.MeshStandardMaterial({ color: 0x252540, roughness: 0.6, metalness: 0.3 });
  [
    [8, -8, 3, 1.5, 3], [-20, 5, 5, 2, 2], [15, 20, 2, 1, 6], [-10, -25, 4, 3, 4],
    [30, -5, 2, 1, 8], [-30, -20, 3, 2, 3], [25, 25, 4, 1.5, 4], [-15, 30, 6, 2, 2],
  ].forEach(([x, z, sx, sy, sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), om);
    m.position.set(x, sy / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    cameraCollisionMeshes.push(m);
    aimCollisionMeshes.push(m);
  });

  // Player - voxel human
  player.mesh = createVoxelHumanoid({
    suitColor: 0x2f7dff,
    accentColor: 0x9fe1ff,
    skinColor: 0xf5d0b0,
    emissive: 0x1144aa,
    emissiveIntensity: 0.08,
    visorColor: 0x0a2038,
    showMuzzleGauntlet: true,
  }).group;
  scene.add(player.mesh);

  // Enemies - voxel humans
  const enemyColors = [0xff3344, 0xff6622, 0xee2266, 0xff4444, 0xcc3355,
                        0xff5533, 0xdd2244, 0xff3366, 0xee4422, 0xff2255];
  const enemyAccent = [0xffa07a, 0xffb86b, 0xff8aa1, 0xff9077, 0xea8ca2];
  [
    [15, 0], [-15, 8], [8, -20], [-12, -12], [20, 15],
    [-25, 0], [0, 25], [10, 10], [-8, 18], [25, -10],
  ].forEach(([x, z], i) => {
    const col = enemyColors[i % enemyColors.length];
    const { group, bodyMesh: ebody } = createVoxelHumanoid({
      suitColor: col,
      accentColor: enemyAccent[i % enemyAccent.length],
      skinColor: 0xefbd96,
      emissive: 0x000000,
      emissiveIntensity: 0,
      visorColor: 0x1a0f10,
    });
    scene.add(group);

    // Health bar (CSS2D)
    const barContainer = document.createElement('div');
    barContainer.className = 'health-bar-container';
    const barFill = document.createElement('div');
    barFill.className = 'health-bar-fill healthy';
    barFill.style.width = '100%';
    barContainer.appendChild(barFill);
    const label = new CSS2DObject(barContainer);
    label.position.set(0, 2.25, 0);
    group.add(label);

    enemies.push({
      pos: new THREE.Vector3(x, 0.6, z),
      vel: new THREE.Vector3(),
      yaw: 0,
      mesh: group,
      bodyMesh: ebody,
      hp: 100,
      maxHp: 100,
      status: {
        freeze: 0,
        stun: 0,
        slowMult: 1,
        slowTime: 0,
        burnDps: 0,
        burnTime: 0,
        burnTick: 0.15,
        burnAcc: 0,
      },
      barFill,
    });
  });

  // Init sandbox with references
  initSandbox(scene, camera, player, enemies, () => playerYaw, () => getPlayerAimPoint(), { triggerSlowMo, triggerFlash });

  // Init forge UI
  initForge({
    onOpen: () => { mouseDown = false; },
    onClose: () => {},
  });

  // Input
  setupInput();
  syncCrosshairToAim();

  // Game loop
  let last = performance.now();
  (function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // Slow-mo
    if (slowMoTimer > 0) {
      slowMoTimer -= dt;
      dt *= slowMoScale;
    }

    // Screen flash decay
    if (flashAlpha > 0) {
      flashEl().style.opacity = flashAlpha;
      flashAlpha *= 0.85;
      if (flashAlpha < 0.01) flashAlpha = 0;
    } else {
      flashEl().style.opacity = 0;
    }

    if (!isForgeOpen()) {
      updateAimLocomotion(dt);
      updatePlayer(dt);
      if (mouseDown) fire();
    }
    updateEnemies(dt);
    updateEntities(dt);
    updateTrails(dt);
    updateSandboxTimers(dt);
    updateParticles(dt);
    updateHealthBars();
    updateCamera(dt);

    if (composer) composer.render();
    else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  })();

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labelRenderer.setSize(innerWidth, innerHeight);
    if (composer) composer.setSize(innerWidth, innerHeight);
    syncCrosshairToAim();
  });
}

// ══════════════════════════════════════════════════
// HEALTH BARS
// ══════════════════════════════════════════════════
function updateHealthBars() {
  for (const e of enemies) {
    const pct = Math.max(0, e.hp / e.maxHp) * 100;
    e.barFill.style.width = pct + '%';
    e.barFill.className = 'health-bar-fill ' + (pct > 60 ? 'healthy' : pct > 30 ? 'mid' : 'low');
  }
}

// ══════════════════════════════════════════════════
// PLAYER
// ══════════════════════════════════════════════════
function updatePlayer(dt) {
  const fwd = new THREE.Vector3(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
  const rgt = new THREE.Vector3(Math.cos(playerYaw), 0, -Math.sin(playerYaw));
  const a = 40, drag = 5;
  const f = new THREE.Vector3();

  if (keys['w'] || keys['arrowup']) f.add(fwd.clone().multiplyScalar(a));
  if (keys['s'] || keys['arrowdown']) f.add(fwd.clone().multiplyScalar(-a));
  if (keys['a']) f.add(rgt.clone().multiplyScalar(-a));
  if (keys['d']) f.add(rgt.clone().multiplyScalar(a));
  if (keys['shift']) f.multiplyScalar(1.8);

  player.vel.add(f.multiplyScalar(dt));
  player.vel.multiplyScalar(1 - drag * dt);
  player.pos.add(player.vel.clone().multiplyScalar(dt));
  player.pos.x = THREE.MathUtils.clamp(player.pos.x, -48, 48);
  player.pos.z = THREE.MathUtils.clamp(player.pos.z, -48, 48);
  player.pos.y = 0.6;
  player.mesh.position.copy(player.pos);
  player.mesh.rotation.y = playerYaw;
  animateHumanoid(player.mesh, dt, Math.hypot(player.vel.x, player.vel.z), {
    localForward: player.vel.dot(fwd),
    localRight: player.vel.dot(rgt),
  });
}

// ══════════════════════════════════════════════════
// ENEMIES
// ══════════════════════════════════════════════════
function updateEnemies(dt) {
  for (const e of enemies) {
    const s = e.status || (e.status = {
      freeze: 0,
      stun: 0,
      slowMult: 1,
      slowTime: 0,
      burnDps: 0,
      burnTime: 0,
      burnTick: 0.15,
      burnAcc: 0,
    });
    const frozen = s.freeze > 0;
    const stunned = s.stun > 0;
    const slowScale = s.slowTime > 0 ? THREE.MathUtils.clamp(s.slowMult ?? 1, 0, 1) : 1;

    const dx = player.pos.x - e.pos.x;
    const dz = player.pos.z - e.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (frozen) {
      e.vel.set(0, 0, 0);
      e.pos.y = Math.max(e.pos.y, 0.6);
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.y = e.yaw;
      animateHumanoid(e.mesh, dt, 0, { frozen: true });
      continue;
    }

    if (!stunned) {
      if (dist > 10 && dist < 60) {
        e.vel.x += (dx / dist) * 15 * slowScale * dt;
        e.vel.z += (dz / dist) * 15 * slowScale * dt;
      } else if (dist < 6 && dist > 0.1) {
        e.vel.x -= (dx / dist) * 12 * slowScale * dt;
        e.vel.z -= (dz / dist) * 12 * slowScale * dt;
      }

      for (const o of enemies) {
        if (o === e) continue;
        const ox = e.pos.x - o.pos.x;
        const oz = e.pos.z - o.pos.z;
        const od = Math.sqrt(ox * ox + oz * oz);
        if (od < 5 && od > 0.1) {
          e.vel.x += (ox / od) * 10 * slowScale * dt;
          e.vel.z += (oz / od) * 10 * slowScale * dt;
        }
      }
    }

    // Gravity pulls enemies down when airborne
    if (e.pos.y > 0.6) {
      e.vel.y -= 20 * dt; // gravity
    } else {
      // On ground: apply ground friction, reset Y
      e.vel.x *= (1 - 3 * dt);
      e.vel.z *= (1 - 3 * dt);
      if (e.vel.y < 0) e.vel.y = 0;
      e.pos.y = 0.6;
    }

    // Air drag (lighter than ground friction)
    if (e.pos.y > 0.6) {
      e.vel.x *= (1 - 1 * dt);
      e.vel.z *= (1 - 1 * dt);
    }

    // Slow applies extra horizontal damping so frozen/slow effects feel stronger.
    if (slowScale < 1) {
      const slowDamp = 1 - Math.min(0.95, (1 - slowScale) * 4 * dt);
      e.vel.x *= slowDamp;
      e.vel.z *= slowDamp;
    }

    e.pos.add(e.vel.clone().multiplyScalar(dt));
    e.pos.x = THREE.MathUtils.clamp(e.pos.x, -48, 48);
    e.pos.z = THREE.MathUtils.clamp(e.pos.z, -48, 48);
    if (e.pos.y < 0.6) e.pos.y = 0.6;
    if (dist > 0.5) e.yaw = Math.atan2(dx, dz);
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = e.yaw;
    animateHumanoid(e.mesh, dt, Math.hypot(e.vel.x, e.vel.z));
  }
}

// ══════════════════════════════════════════════════
// CAMERA
// ══════════════════════════════════════════════════
function updateCamera(dt) {
  const p = player.pos;
  tempCameraForward.set(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
  tempCameraRight.set(Math.cos(playerYaw), 0, -Math.sin(playerYaw));

  tempCameraPivot.copy(p).addScaledVector(WORLD_UP, CAMERA_RIG.pivotHeight);
  tempCameraShoulder.copy(tempCameraPivot)
    .addScaledVector(tempCameraRight, CAMERA_RIG.shoulderRight)
    .addScaledVector(WORLD_UP, CAMERA_RIG.shoulderUp);

  tempCameraDesired.copy(tempCameraShoulder)
    .addScaledVector(tempCameraForward, CAMERA_RIG.shoulderForward - CAMERA_RIG.distance)
    .addScaledVector(WORLD_UP, CAMERA_RIG.followHeight);

  let resolvedDistance = CAMERA_RIG.distance;
  tempCameraRayDir.copy(tempCameraDesired).sub(tempCameraShoulder);
  const desiredLength = tempCameraRayDir.length();
  if (desiredLength > 0.001 && cameraCollisionMeshes.length > 0) {
    tempCameraRayDir.multiplyScalar(1 / desiredLength);
    cameraCollisionRay.set(tempCameraShoulder, tempCameraRayDir);
    cameraCollisionRay.far = desiredLength;
    const hits = cameraCollisionRay.intersectObjects(cameraCollisionMeshes, false);
    if (hits.length > 0) {
      const safeDistance = Math.max(CAMERA_RIG.minDistance, hits[0].distance - CAMERA_RIG.collisionPadding);
      tempCameraDesired.copy(tempCameraShoulder).addScaledVector(tempCameraRayDir, safeDistance);
      resolvedDistance = safeDistance;
    }
  }

  tempCameraLookAt.copy(p)
    .addScaledVector(tempCameraRight, CAMERA_RIG.shoulderRight * 0.45)
    .addScaledVector(WORLD_UP, CAMERA_RIG.lookHeight)
    .addScaledVector(
      tempCameraForward,
      Math.max(CAMERA_RIG.minDistance + 1.2, CAMERA_RIG.lookAhead * (resolvedDistance / CAMERA_RIG.distance))
    );

  const posAlpha = dt > 0 ? dampFactor(CAMERA_RIG.positionSharpness, dt) : 1;
  const lookAlpha = dt > 0 ? dampFactor(CAMERA_RIG.lookSharpness, dt) : 1;
  if (!cameraState.initialized) {
    cameraState.position.copy(tempCameraDesired);
    cameraState.lookAt.copy(tempCameraLookAt);
    cameraState.initialized = true;
  } else {
    cameraState.position.lerp(tempCameraDesired, posAlpha);
    cameraState.lookAt.lerp(tempCameraLookAt, lookAlpha);
  }

  camera.position.copy(cameraState.position);

  const shake = getShake();
  if (shake.time > 0) {
    tickShake(dt);
    camera.position.x += (Math.random() - 0.5) * shake.amt;
    camera.position.y += (Math.random() - 0.5) * shake.amt * 0.5;
    camera.position.z += (Math.random() - 0.5) * shake.amt;
  }

  camera.lookAt(cameraState.lookAt);
}

// ══════════════════════════════════════════════════
// INPUT
// ══════════════════════════════════════════════════
function setupInput() {
  window.addEventListener('keydown', (e) => {
    if (isForgeOpen()) return;
    keys[e.key.toLowerCase()] = true;
    if (e.key === 't' || e.key === 'T') openForge();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  renderer.domElement.addEventListener('mousedown', (e) => {
    if (isForgeOpen()) return;
    if (e.button === 0) mouseDown = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
  window.addEventListener('mousemove', (e) => { updateAimFromMouseEvent(e); });

  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ══════════════════════════════════════════════════
// API KEY GATE
// ══════════════════════════════════════════════════
init();
