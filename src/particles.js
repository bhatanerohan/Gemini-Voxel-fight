import * as THREE from 'three';

/**
 * GPU-efficient particle pool using THREE.Points.
 * Renders ALL particles in a single draw call.
 */
export class ParticlePool {
  constructor(scene, maxParticles = 600) {
    this.scene = scene;
    this.max = maxParticles;
    this.count = 0;

    // Per-particle data (CPU side)
    this.alive = new Uint8Array(maxParticles);
    this.ages = new Float32Array(maxParticles);
    this.lifetimes = new Float32Array(maxParticles);
    this.velocities = new Float32Array(maxParticles * 3);
    this.gravities = new Float32Array(maxParticles);
    this.startSizes = new Float32Array(maxParticles);
    this.activeSlots = new Int32Array(maxParticles);
    this.activePositions = new Int32Array(maxParticles);
    this.freeSlots = new Int32Array(maxParticles);
    this.activePositions.fill(-1);
    for (let i = 0; i < maxParticles; i++) {
      this.freeSlots[i] = maxParticles - 1 - i;
    }
    this.freeTop = maxParticles;
    this._color = new THREE.Color();

    // GPU buffers
    this.positions = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 4); // RGBA
    this.sizes = new Float32Array(maxParticles);

    const geo = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.positionAttr);
    geo.setAttribute('color', this.colorAttr);
    geo.setAttribute('size', this.sizeAttr);

    // Custom shader for sized + colored + fading points
    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float size;
        attribute vec4 color;
        varying vec4 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPosition.z);
          gl_PointSize = clamp(gl_PointSize, 1.0, 64.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec4 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = vColor.a * smoothstep(0.5, 0.2, d);
          gl_FragColor = vec4(vColor.rgb, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Burst spawn particles.
   * @param {Object} opts
   * @param {THREE.Vector3|{x,y,z}} opts.position - spawn center
   * @param {number} opts.color - hex color (0xff6600)
   * @param {number} opts.count - number of particles (default 12)
   * @param {number} opts.speed - outward speed (default 8)
   * @param {number} opts.lifetime - seconds (default 0.6)
   * @param {number} opts.size - point size (default 3)
   * @param {number} opts.gravity - gravity multiplier (default 1)
   */
  burst(opts = {}) {
    const {
      position = { x: 0, y: 0, z: 0 },
      color = 0xff6600,
      count = 12,
      speed = 8,
      lifetime = 0.6,
      size = 3,
      gravity = 1,
    } = opts;

    const px = position.x ?? 0;
    const py = position.y ?? 0;
    const pz = position.z ?? 0;

    const col = this._color.set(color);

    let spawned = false;

    for (let i = 0; i < count; i++) {
      const slot = this._acquireSlot();
      if (slot === -1) break; // pool full

      const i3 = slot * 3;
      const i4 = slot * 4;
      spawned = true;

      this.alive[slot] = 1;
      this.ages[slot] = 0;
      this.lifetimes[slot] = lifetime * (0.7 + Math.random() * 0.6);
      this.startSizes[slot] = size * (0.6 + Math.random() * 0.8);
      this.gravities[slot] = gravity;

      this.positions[i3] = px + (Math.random() - 0.5) * 0.3;
      this.positions[i3 + 1] = py + (Math.random() - 0.5) * 0.3;
      this.positions[i3 + 2] = pz + (Math.random() - 0.5) * 0.3;

      // Random outward velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.7; // bias upward
      const sp = speed * (0.5 + Math.random() * 0.8);
      this.velocities[i3] = Math.sin(phi) * Math.cos(theta) * sp;
      this.velocities[i3 + 1] = Math.cos(phi) * sp * 0.8 + Math.random() * speed * 0.3;
      this.velocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * sp;

      this.colors[i4] = col.r;
      this.colors[i4 + 1] = col.g;
      this.colors[i4 + 2] = col.b;
      this.colors[i4 + 3] = 1.0;

      this.sizes[slot] = this.startSizes[slot];
    }

    if (!spawned) return;
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  _acquireSlot() {
    if (this.freeTop <= 0) return -1;
    const slot = this.freeSlots[--this.freeTop];
    this.activePositions[slot] = this.count;
    this.activeSlots[this.count] = slot;
    this.count++;
    return slot;
  }

  _releaseSlot(slot, activeIndex = this.activePositions[slot]) {
    if (activeIndex < 0 || activeIndex >= this.count) return;

    const lastIndex = this.count - 1;
    const lastSlot = this.activeSlots[lastIndex];
    if (activeIndex !== lastIndex) {
      this.activeSlots[activeIndex] = lastSlot;
      this.activePositions[lastSlot] = activeIndex;
    }

    this.activePositions[slot] = -1;
    this.count = lastIndex;
    this.freeSlots[this.freeTop++] = slot;
  }

  update(dt) {
    if (this.count === 0) return;

    let i = 0;
    let didUpdate = false;

    while (i < this.count) {
      const slot = this.activeSlots[i];
      this.ages[slot] += dt;

      const life = this.lifetimes[slot];
      const t = this.ages[slot] / life; // 0 to 1

      if (t >= 1) {
        const i4 = slot * 4;
        this.alive[slot] = 0;
        this.colors[i4 + 3] = 0;
        this.sizes[slot] = 0;
        this._releaseSlot(slot, i);
        didUpdate = true;
        continue;
      }

      const i3 = slot * 3;
      const i4 = slot * 4;

      // Apply gravity
      this.velocities[i3 + 1] -= 9.81 * this.gravities[slot] * dt;

      // Integrate position
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;

      // Floor bounce
      if (this.positions[i3 + 1] < 0.05) {
        this.positions[i3 + 1] = 0.05;
        this.velocities[i3 + 1] *= -0.3;
        this.velocities[i3] *= 0.8;
        this.velocities[i3 + 2] *= 0.8;
      }

      // Fade alpha and shrink
      const fade = 1 - t;
      this.colors[i4 + 3] = fade;
      this.sizes[slot] = this.startSizes[slot] * (1 + t * 0.5) * fade;
      didUpdate = true;
      i++;
    }

    if (!didUpdate) return;

    // Upload only while active particles are animating or a particle just died.
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }
}
