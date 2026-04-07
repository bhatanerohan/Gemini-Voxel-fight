import * as THREE from 'three';
import { ARENA_FLOOR_SIZE, ARENA_HALF_EXTENT } from './gameConfig.js';

export function buildArena({
  scene,
  cameraCollisionMeshes,
  aimCollisionMeshes,
  actorCollisionBoxes,
  walkableSurfaces,
}) {
  const addArenaCollision = (mesh) => {
    cameraCollisionMeshes.push(mesh);
    aimCollisionMeshes.push(mesh);
    mesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    actorCollisionBoxes.push({
      minX: bounds.min.x,
      maxX: bounds.max.x,
      minY: bounds.min.y,
      maxY: bounds.max.y,
      minZ: bounds.min.z,
      maxZ: bounds.max.z,
    });
  };

  const addArenaBox = ({
    x, y, z, sx, sy, sz, material,
    rotationX = 0, rotationY = 0, rotationZ = 0,
    castShadow = true,
    receiveShadow = true,
    collision = true,
    walkable = false,
    surfaceInset = 0.4,
  }) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    scene.add(mesh);
    if (collision) addArenaCollision(mesh);
    if (walkable && rotationX === 0 && rotationY === 0 && rotationZ === 0) {
      walkableSurfaces.push({
        minX: x - sx * 0.5 + surfaceInset,
        maxX: x + sx * 0.5 - surfaceInset,
        minZ: z - sz * 0.5 + surfaceInset,
        maxZ: z + sz * 0.5 - surfaceInset,
        height: y + sy * 0.5,
      });
    }
    return mesh;
  };

  const addTrimPlate = (x, y, z, sx, sz, color = 0x16b9ff) => {
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(sx, 0.12, sz),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.45,
        roughness: 0.28,
        metalness: 0.82,
      }),
    );
    trim.position.set(x, y, z);
    trim.castShadow = false;
    trim.receiveShadow = true;
    scene.add(trim);
    return trim;
  };

  const addStairRamp = ({
    startX,
    startZ,
    endX,
    endZ,
    width,
    steps,
    heightEnd,
    material,
    trimColor = 0x16b9ff,
    thickness = 0.8,
    heightStart = 0,
  }) => {
    const dx = endX - startX;
    const dz = endZ - startZ;
    const alongX = Math.abs(dx) >= Math.abs(dz);
    const run = alongX ? Math.abs(dx) : Math.abs(dz);
    const stepRun = run / steps;

    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps;
      const topY = THREE.MathUtils.lerp(heightStart, heightEnd, t);
      const centerX = alongX ? startX + Math.sign(dx || 1) * stepRun * (i + 0.5) : startX;
      const centerZ = alongX ? startZ : startZ + Math.sign(dz || 1) * stepRun * (i + 0.5);
      const sx = alongX ? stepRun + 0.25 : width;
      const sz = alongX ? width : stepRun + 0.25;

      addArenaBox({
        x: centerX,
        y: topY - thickness * 0.5,
        z: centerZ,
        sx,
        sy: thickness,
        sz,
        material,
        walkable: true,
        surfaceInset: 0.15,
      });

      if (i === steps - 1 || i % 2 === 1) {
        addTrimPlate(centerX, topY + 0.05, centerZ, Math.max(1.2, sx - 0.35), Math.max(1.2, sz - 0.35), trimColor);
      }
    }
  };

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0c101d, roughness: 0.94, metalness: 0.08 });
  const floorInsetMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.86, metalness: 0.18 });
  const stripMat = new THREE.MeshStandardMaterial({
    color: 0x1ea8ff,
    emissive: 0x0a325e,
    emissiveIntensity: 0.72,
    roughness: 0.22,
    metalness: 0.8,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x161d34,
    roughness: 0.68,
    metalness: 0.24,
    transparent: true,
    opacity: 0.46,
  });
  const platformMat = new THREE.MeshStandardMaterial({ color: 0x2a314d, roughness: 0.56, metalness: 0.28 });
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x20263f, roughness: 0.62, metalness: 0.22 });
  const hotZoneMat = new THREE.MeshStandardMaterial({ color: 0x40304e, roughness: 0.48, metalness: 0.26 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_FLOOR_SIZE, ARENA_FLOOR_SIZE), floorMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const insetFloor = new THREE.Mesh(new THREE.PlaneGeometry(136, 136), floorInsetMat);
  insetFloor.rotation.x = -Math.PI / 2;
  insetFloor.position.y = 0.02;
  insetFloor.receiveShadow = true;
  scene.add(insetFloor);

  const grid = new THREE.GridHelper(160, 80, 0x1f2e63, 0x121a34);
  grid.position.y = 0.02;
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  [
    [0, 0.18, -(ARENA_HALF_EXTENT + 1.8), ARENA_HALF_EXTENT * 2 + 8, 0.36, 0.7],
    [0, 0.18, ARENA_HALF_EXTENT + 1.8, ARENA_HALF_EXTENT * 2 + 8, 0.36, 0.7],
    [-(ARENA_HALF_EXTENT + 1.8), 0.18, 0, 0.7, 0.36, ARENA_HALF_EXTENT * 2 + 8],
    [ARENA_HALF_EXTENT + 1.8, 0.18, 0, 0.7, 0.36, ARENA_HALF_EXTENT * 2 + 8],
  ].forEach(([x, y, z, sx, sy, sz]) => {
    addArenaBox({ x, y, z, sx, sy, sz, material: stripMat, castShadow: false, collision: false });
  });

  [
    [0, -(ARENA_HALF_EXTENT + 0.5), ARENA_HALF_EXTENT * 2 + 2, 6, 1.2],
    [0, ARENA_HALF_EXTENT + 0.5, ARENA_HALF_EXTENT * 2 + 2, 6, 1.2],
    [-(ARENA_HALF_EXTENT + 0.5), 0, 1.2, 6, ARENA_HALF_EXTENT * 2 + 2],
    [ARENA_HALF_EXTENT + 0.5, 0, 1.2, 6, ARENA_HALF_EXTENT * 2 + 2],
  ].forEach(([x, z, sx, sy, sz]) => {
    addArenaBox({ x, y: sy / 2, z, sx, sy, sz, material: wallMat });
  });

  const walkableThickness = 1;
  const teamPlatformTop = 3.5;
  const ringTop = 4.0;
  const perchTop = 5.8;
  const teamPlatformY = teamPlatformTop - walkableThickness * 0.5;
  const ringY = ringTop - walkableThickness * 0.5;
  const perchY = perchTop - walkableThickness * 0.5;

  addArenaBox({ x: 0, y: 1.1, z: 0, sx: 14, sy: 2.2, sz: 14, material: pillarMat });
  addTrimPlate(0, 2.28, 0, 11.4, 11.4, 0x53d7ff);
  addArenaBox({ x: 0, y: 5.35, z: 0, sx: 8, sy: 8.5, sz: 8, material: pillarMat });
  addTrimPlate(0, 9.68, 0, 5.9, 5.9, 0x6ee7ff);

  [
    [0, -12, 18, 6],
    [0, 12, 18, 6],
    [-12, 0, 6, 18],
    [12, 0, 6, 18],
  ].forEach(([x, z, sx, sz]) => {
    addArenaBox({
      x,
      y: ringY,
      z,
      sx,
      sy: walkableThickness,
      sz,
      material: hotZoneMat,
      walkable: true,
      surfaceInset: 0.35,
    });
    addTrimPlate(x, ringTop + 0.08, z, Math.max(1.8, sx - 0.8), Math.max(1.8, sz - 0.8), 0xff5f92);
  });

  [
    { z: -38, trimColor: 0x22d3ee },
    { z: 38, trimColor: 0xff8a4c },
  ].forEach(({ z, trimColor }) => {
    const direction = Math.sign(z);
    const frontZ = z - direction * 4;

    addArenaBox({
      x: 0,
      y: teamPlatformY,
      z,
      sx: 30,
      sy: walkableThickness,
      sz: 14,
      material: platformMat,
      walkable: true,
      surfaceInset: 0.4,
    });
    addTrimPlate(0, teamPlatformTop + 0.08, z, 27.8, 11.8, trimColor);

    addArenaBox({
      x: 0,
      y: teamPlatformTop + 0.75,
      z: frontZ,
      sx: 8,
      sy: 1.5,
      sz: 3.5,
      material: pillarMat,
    });
    addTrimPlate(0, teamPlatformTop + 1.58, frontZ, 6.6, 2.1, trimColor);

    [-2, 2].forEach((laneOffset) => {
      addStairRamp({
        startX: -23,
        startZ: z + laneOffset,
        endX: -15,
        endZ: z + laneOffset,
        width: 4.5,
        steps: 6,
        heightEnd: teamPlatformTop,
        material: platformMat,
        trimColor,
      });
      addStairRamp({
        startX: 23,
        startZ: z + laneOffset,
        endX: 15,
        endZ: z + laneOffset,
        width: 4.5,
        steps: 6,
        heightEnd: teamPlatformTop,
        material: platformMat,
        trimColor,
      });
    });

    addStairRamp({
      startX: 0,
      startZ: direction * 31,
      endX: 0,
      endZ: direction * 15,
      width: 11.5,
      steps: 7,
      heightStart: teamPlatformTop,
      heightEnd: ringTop,
      material: platformMat,
      trimColor,
    });
  });

  [-44, 44].forEach((x) => {
    addArenaBox({ x, y: 0.7, z: 0, sx: 2.5, sy: 1.4, sz: 44, material: pillarMat });
  });
  [-34, 34].forEach((x) => {
    addArenaBox({ x, y: 0.7, z: -13, sx: 2.5, sy: 1.4, sz: 18, material: pillarMat });
    addArenaBox({ x, y: 0.7, z: 13, sx: 2.5, sy: 1.4, sz: 18, material: pillarMat });
  });

  [
    [-24, -24, 10.5, 1.8, 2.8],
    [24, -24, 2.8, 1.8, 10.5],
    [-24, 24, 2.8, 1.8, 10.5],
    [24, 24, 10.5, 1.8, 2.8],
  ].forEach(([x, z, sx, sy, sz]) => {
    addArenaBox({ x, y: sy * 0.5, z, sx, sy, sz, material: platformMat });
    addTrimPlate(x, sy + 0.08, z, Math.max(1.5, sx - 0.95), Math.max(1.5, sz - 0.95));
  });

  [-20, 20].forEach((x) => {
    addArenaBox({ x, y: 2.65, z: 0, sx: 1.8, sy: 5.3, sz: 1.8, material: pillarMat });
    addArenaBox({
      x,
      y: perchY,
      z: 0,
      sx: 5,
      sy: walkableThickness,
      sz: 5,
      material: platformMat,
      walkable: true,
      surfaceInset: 0.2,
    });
    addTrimPlate(x, perchTop + 0.08, 0, 3.9, 3.9, 0x6ee7ff);
  });

  [-39, 39].forEach((x) => {
    addArenaBox({ x, y: 3.3, z: 0, sx: 4.8, sy: 6.6, sz: 4.8, material: pillarMat });
  });

  scene.userData.weaponCollisionMeshes = aimCollisionMeshes;
}

