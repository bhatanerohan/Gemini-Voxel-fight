// src/arenaBuilder.js — Applies AI-generated arena config to Three.js scene
import * as THREE from 'three';

let _hazardZones = [];
let _envParticleTimer = 0;
let _envConfig = null;
let _groundPulseMesh = null;
let _particlePool = null;
let _skyMesh = null;

// ── Gradient Sky Dome ──

const SKY_VERT = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;

const SKY_FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition).y;
  vec3 col;
  if (h > 0.0) {
    col = mix(horizonColor, topColor, pow(h, 0.6));
  } else {
    col = mix(horizonColor, bottomColor, pow(-h, 0.4));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function createOrUpdateSky(scene, topHex, horizonHex, bottomHex) {
  const top = new THREE.Color(topHex);
  const horizon = new THREE.Color(horizonHex);
  const bottom = new THREE.Color(bottomHex);

  if (_skyMesh) {
    _skyMesh.material.uniforms.topColor.value.copy(top);
    _skyMesh.material.uniforms.horizonColor.value.copy(horizon);
    _skyMesh.material.uniforms.bottomColor.value.copy(bottom);
    return;
  }

  const skyGeo = new THREE.SphereGeometry(400, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      topColor: { value: top },
      horizonColor: { value: horizon },
      bottomColor: { value: bottom },
    },
    side: THREE.BackSide,
    depthWrite: false,
  });
  _skyMesh = new THREE.Mesh(skyGeo, skyMat);
  _skyMesh.renderOrder = -1;
  scene.add(_skyMesh);

  // Disable the flat background color so the sky dome is visible
  scene.background = null;
}

export function setArenaParticlePool(pool) { _particlePool = pool; }

/**
 * Apply a generated arena config to the scene.
 * Replaces cover blocks, adds hazards, sets theme.
 */
export function buildArenaFromConfig(scene, config, coverBlockMeshes, collisionMeshes) {
  const { theme, coverBlocks, hazards, platforms, environmentalEffects } = config;

  // 1. Apply theme colors + gradient sky
  if (theme.skyTop && theme.skyHorizon && theme.skyBottom) {
    createOrUpdateSky(scene, theme.skyTop, theme.skyHorizon, theme.skyBottom);
  } else if (theme.backgroundColor) {
    scene.background = new THREE.Color(theme.backgroundColor);
  }
  if (theme.fogColor) scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity || 0.011);

  // Recolor floor (first plane mesh found)
  scene.traverse(child => {
    if (child.isMesh && child.geometry?.type === 'PlaneGeometry' && child.rotation.x === -Math.PI / 2) {
      child.material.color.set(theme.floorColor || '#0e0e1a');
    }
  });

  // 2. Remove old cover blocks
  for (const block of [...coverBlockMeshes]) {
    scene.remove(block);
    block.geometry?.dispose();
    block.material?.dispose();
    const ci = collisionMeshes.indexOf(block);
    if (ci !== -1) collisionMeshes.splice(ci, 1);
  }
  coverBlockMeshes.length = 0;

  // 3. Place new cover blocks
  for (const block of coverBlocks) {
    const geom = new THREE.BoxGeometry(
      Math.max(0.5, block.width || 2),
      Math.max(0.5, block.height || 2),
      Math.max(0.5, block.depth || 2)
    );
    const mat = new THREE.MeshStandardMaterial({
      color: block.color || '#252540',
      flatShading: true,
      roughness: 0.6,
      metalness: 0.3,
    });
    const mesh = new THREE.Mesh(geom, mat);
    const h = block.height || 2;
    mesh.position.set(
      THREE.MathUtils.clamp(block.x || 0, -45, 45),
      h / 2,
      THREE.MathUtils.clamp(block.z || 0, -45, 45)
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    coverBlockMeshes.push(mesh);
    collisionMeshes.push(mesh);
  }

  // 4. Place hazards
  clearHazards(scene);
  for (const hazard of (hazards || [])) {
    createHazardZone(scene, hazard);
  }

  // 5. Place platforms
  for (const plat of (platforms || [])) {
    const geom = new THREE.BoxGeometry(plat.width || 6, plat.height || 1.5, plat.depth || 6);
    const mat = new THREE.MeshStandardMaterial({
      color: plat.color || '#2a2a50',
      flatShading: true,
      roughness: 0.5,
      metalness: 0.4,
    });
    const mesh = new THREE.Mesh(geom, mat);
    const h = plat.height || 1.5;
    mesh.position.set(
      THREE.MathUtils.clamp(plat.x || 0, -45, 45),
      h / 2,
      THREE.MathUtils.clamp(plat.z || 0, -45, 45)
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    collisionMeshes.push(mesh);
  }

  // 6. Update arena boundary glow
  scene.traverse(child => {
    if (child.isMesh && child.material?.emissive && child.geometry?.type === 'BoxGeometry') {
      // Check if it's a boundary strip (positioned at ±50)
      const p = child.position;
      if (Math.abs(p.x) > 49 || Math.abs(p.z) > 49) {
        if (theme.wallColor) {
          child.material.color.set(theme.wallColor);
          child.material.emissive.set(theme.wallColor);
          child.material.emissiveIntensity = 0.7;
        }
      }
    }
  });

  // 7. Setup environmental effects
  _envConfig = environmentalEffects;

  // 8. Ground pulse
  if (environmentalEffects?.groundPulse) {
    if (!_groundPulseMesh) {
      const pulseGeom = new THREE.PlaneGeometry(200, 200);
      const pulseMat = new THREE.MeshBasicMaterial({
        color: environmentalEffects.groundPulseColor || '#ffffff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      _groundPulseMesh = new THREE.Mesh(pulseGeom, pulseMat);
      _groundPulseMesh.rotation.x = -Math.PI / 2;
      _groundPulseMesh.position.y = 0.05;
      scene.add(_groundPulseMesh);
    } else {
      _groundPulseMesh.material.color.set(environmentalEffects.groundPulseColor || '#ffffff');
    }
  }
}

function createHazardZone(scene, hazard) {
  const radius = THREE.MathUtils.clamp(hazard.radius || 3, 1, 8);
  const color = hazard.color || '#ff3300';

  // Glowing circle on ground
  const geom = new THREE.CircleGeometry(radius, 24);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    THREE.MathUtils.clamp(hazard.x || 0, -42, 42),
    0.04,
    THREE.MathUtils.clamp(hazard.z || 0, -42, 42)
  );
  scene.add(mesh);

  // Pulsing ring
  const ringGeom = new THREE.RingGeometry(radius - 0.15, radius, 24);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(mesh.position);
  ring.position.y = 0.05;
  scene.add(ring);

  _hazardZones.push({
    mesh,
    ring,
    config: hazard,
    x: mesh.position.x,
    z: mesh.position.z,
    radius,
    dps: hazard.damagePerSecond || 5,
    statusEffect: hazard.statusEffect || 'none',
    timer: 0,
  });
}

function clearHazards(scene) {
  for (const hz of _hazardZones) {
    scene.remove(hz.mesh);
    scene.remove(hz.ring);
    hz.mesh.geometry.dispose();
    hz.mesh.material.dispose();
    hz.ring.geometry.dispose();
    hz.ring.material.dispose();
  }
  _hazardZones = [];
}

/**
 * Update hazards (pulsing, damage) and environmental effects.
 * Called from main game loop.
 */
export function updateArenaEffects(dt, playerPos, applyPlayerDamage, elapsed) {
  // Hazard pulsing and damage
  for (const hz of _hazardZones) {
    // Pulse opacity
    hz.ring.material.opacity = 0.4 + Math.sin(elapsed * 3) * 0.2;
    hz.mesh.material.opacity = 0.2 + Math.sin(elapsed * 2) * 0.1;

    // Check player distance
    if (playerPos) {
      const dx = playerPos.x - hz.x;
      const dz = playerPos.z - hz.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < hz.radius) {
        hz.timer += dt;
        if (hz.timer >= 0.5) {
          hz.timer = 0;
          applyPlayerDamage(hz.dps);
        }
      }
    }
  }

  // Ground pulse
  if (_groundPulseMesh) {
    _groundPulseMesh.material.opacity = 0.03 + Math.sin(elapsed * 1.5) * 0.02;
  }

  // Environmental particles
  if (_envConfig?.particles && _envConfig.particles !== 'none' && _particlePool) {
    _envParticleTimer += dt;
    if (_envParticleTimer > 0.1) {
      _envParticleTimer = 0;
      const px = (Math.random() - 0.5) * 80;
      const pz = (Math.random() - 0.5) * 80;
      const py = 8 + Math.random() * 15;

      let speed = 2, gravity = 1, size = 2, lifetime = 3;
      switch (_envConfig.particles) {
        case 'rain': speed = 15; gravity = 3; size = 1; lifetime = 1; break;
        case 'embers': speed = 3; gravity = -0.5; size = 2; lifetime = 2; break;
        case 'snow': speed = 1; gravity = 0.3; size = 2; lifetime = 4; break;
        case 'spores': speed = 1.5; gravity = -0.2; size = 3; lifetime = 3; break;
        case 'debris': speed = 2; gravity = 1; size = 2; lifetime = 2; break;
      }

      _particlePool.burst({
        position: { x: px, y: py, z: pz },
        color: _envConfig.particleColor || '#ffffff',
        count: 2,
        speed,
        lifetime,
        size,
        gravity,
      });
    }
  }
}

export function getHazardZones() { return _hazardZones; }
