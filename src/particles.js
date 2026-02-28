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
    this._cursor = 0; // round-robin cursor for fast slot finding

    // Per-particle data (CPU side)
    this.alive = new Uint8Array(maxParticles);
    this.ages = new Float32Array(maxParticles);
    this.lifetimes = new Float32Array(maxParticles);
    this.velocities = new Float32Array(maxParticles * 3);
    this.gravities = new Float32Array(maxParticles);
    this.startSizes = new Float32Array(maxParticles);

    // GPU buffers
    this.positions = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 4); // RGBA
    this.sizes = new Float32Array(maxParticles);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));

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

    const col = new THREE.Color(color);

    for (let i = 0; i < count; i++) {
      const slot = this._findSlot();
      if (slot === -1) break; // pool full

      const i3 = slot * 3;
      const i4 = slot * 4;

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
  }

  _findSlot() {
    // Round-robin search from cursor for O(1) average case
    for (let j = 0; j < this.max; j++) {
      const i = (this._cursor + j) % this.max;
      if (!this.alive[i]) {
        this._cursor = (i + 1) % this.max;
        return i;
      }
    }
    return -1; // pool exhausted
  }

  update(dt) {
    let anyAlive = false;

    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) {
        this.sizes[i] = 0; // hide dead particles
        continue;
      }

      anyAlive = true;
      this.ages[i] += dt;

      const life = this.lifetimes[i];
      const t = this.ages[i] / life; // 0 to 1

      if (t >= 1) {
        this.alive[i] = 0;
        this.sizes[i] = 0;
        continue;
      }

      const i3 = i * 3;
      const i4 = i * 4;

      // Apply gravity
      this.velocities[i3 + 1] -= 9.81 * this.gravities[i] * dt;

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
      this.sizes[i] = this.startSizes[i] * (1 + t * 0.5) * fade;
    }

    // Upload to GPU
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
  }
}
