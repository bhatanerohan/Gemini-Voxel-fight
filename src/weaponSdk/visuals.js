import {
  addVisualObject,
  clamp01,
  normalizeDirection,
  registerLifetime,
  removeVisualObject,
  resolvePointRef,
  toVec3,
} from './utils.js';

function makeColor(runtime, color, fallback) {
  return color instanceof runtime.THREE.Color ? color : new runtime.THREE.Color(color ?? fallback);
}

export function createVisualHelpers(runtime) {
  const { THREE } = runtime;

  const helpers = {
    spawnImpactBurst(position, opts = {}) {
      const p = toVec3(runtime, position);
      const color = opts.color ?? 0x88ddff;
      const particles = Math.max(0, Math.floor(opts.particles ?? opts.count ?? 20));
      const speed = opts.speed ?? 8;
      const lifetime = opts.particleLifetime ?? opts.lifetime ?? 0.3;
      const size = opts.size ?? 3.5;
      const gravity = opts.gravity ?? 0.2;

      if (typeof runtime.burstParticles === 'function') {
        runtime.burstParticles({
          position: p,
          color,
          count: particles,
          speed,
          lifetime,
          size,
          gravity,
        });
      }

      let light = null;
      if (opts.light || opts.lightIntensity) {
        const intensity = opts.lightIntensity ?? 3;
        const lightLife = opts.lightLife ?? 0.15;
        light = new THREE.PointLight(color, intensity, opts.lightRange ?? 8);
        light.position.copy(p);
        if (typeof runtime.addLight === 'function') runtime.addLight(light);
        else if (runtime.scene) runtime.scene.add(light);

        registerLifetime(runtime, lightLife, ({ progress }) => {
          if (!light) return false;
          light.intensity = intensity * (1 - progress);
          if (progress >= 1) {
            if (typeof runtime.removeLight === 'function') runtime.removeLight(light);
            else if (runtime.scene) runtime.scene.remove(light);
            return false;
          }
          return true;
        });
      }

      if (opts.ringRadius) {
        helpers.spawnPulseRing(p, {
          radius: opts.ringRadius,
          color,
          life: opts.ringLife ?? 0.2,
          width: opts.ringWidth ?? 0.35,
        });
      }

      return { position: p, light };
    },

    spawnBeam: (start, end, opts = {}) => {
      const a = toVec3(runtime, start);
      const b = toVec3(runtime, end);
      const delta = b.clone().sub(a);
      const length = Math.max(0.001, delta.length());
      const dir = delta.normalize();
      const width = Math.max(0.01, opts.width ?? 0.1);
      const color = opts.color ?? 0x66ccff;
      const life = opts.life ?? 0.12;
      const opacity = clamp01(opts.opacity ?? 0.9);
      const jitter = Math.max(0, opts.jitter ?? 0);
      const radialSegments = Math.max(3, Math.floor(opts.radialSegments ?? 8));

      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(width, width, length, radialSegments, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );

      const mid = a.clone().add(b).multiplyScalar(0.5);
      beam.position.copy(mid);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      addVisualObject(runtime, beam);

      registerLifetime(runtime, life, ({ progress }) => {
        if (!beam.parent) return false;
        beam.material.opacity = opacity * (1 - progress);
        if (jitter > 0) {
          beam.position.copy(mid);
          beam.position.x += (Math.random() - 0.5) * jitter;
          beam.position.y += (Math.random() - 0.5) * jitter;
          beam.position.z += (Math.random() - 0.5) * jitter;
        }
        if (progress >= 1) {
          removeVisualObject(runtime, beam);
          return false;
        }
        return true;
      });

      return beam;
    },

    spawnBolt: (start, end, opts = {}) => {
      const a = toVec3(runtime, start);
      const b = toVec3(runtime, end);
      const dir = b.clone().sub(a);
      const dist = Math.max(0.001, dir.length());
      dir.normalize();

      const segments = Math.max(2, Math.floor(opts.segments ?? 8));
      const zigzag = Math.max(0, opts.zigzag ?? 0.35);
      const color = opts.color ?? 0x9be8ff;
      const life = opts.life ?? 0.08;
      const opacity = clamp01(opts.opacity ?? 0.95);
      const flicker = !!opts.flicker;

      const basisSeed = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(dir, basisSeed).normalize();
      const up2 = new THREE.Vector3().crossVectors(side, dir).normalize();

      const points = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const p = a.clone().lerp(b, t);
        if (i !== 0 && i !== segments && zigzag > 0) {
          const amp = zigzag * (0.35 + 0.65 * Math.sin(t * Math.PI)) * (dist / 8);
          const sx = (Math.random() - 0.5) * 2;
          const sy = (Math.random() - 0.5) * 2;
          p.addScaledVector(side, amp * sx);
          p.addScaledVector(up2, amp * sy);
        }
        points.push(p);
      }

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );

      addVisualObject(runtime, line);
      registerLifetime(runtime, life, ({ progress }) => {
        if (!line.parent) return false;
        line.material.opacity = opacity * (1 - progress) * (flicker ? (0.75 + Math.random() * 0.25) : 1);
        if (progress >= 1) {
          removeVisualObject(runtime, line);
          return false;
        }
        return true;
      });

      return line;
    },

    spawnPulseRing: (center, opts = {}) => {
      const c = resolvePointRef(runtime, center);
      const radius = Math.max(0.05, opts.radius ?? 3);
      const width = Math.max(0.01, opts.width ?? 0.25);
      const life = opts.life ?? 0.25;
      const opacity = clamp01(opts.opacity ?? 0.7);
      const color = opts.color ?? 0xffffff;

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(Math.max(0.01, 1 - width * 0.5), 1 + width * 0.5, 32),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(c);
      ring.position.y += opts.yOffset ?? 0.08;
      addVisualObject(runtime, ring);

      registerLifetime(runtime, life, ({ progress }) => {
        if (!ring.parent) return false;
        ring.scale.setScalar(1 + progress * radius);
        ring.material.opacity = opacity * (1 - progress);
        if (progress >= 1) {
          removeVisualObject(runtime, ring);
          return false;
        }
        return true;
      });

      return ring;
    },

    spawnZoneAura: (center, opts = {}) => {
      const radius = Math.max(0.2, opts.radius ?? 3);
      const thickness = Math.max(0.02, opts.thickness ?? 0.09);
      const color = makeColor(runtime, opts.color, 0x66ccff);
      const life = opts.life;
      const opacity = clamp01(opts.opacity ?? 0.5);
      const pulse = opts.pulse ?? 0.12;
      const spin = opts.spin ?? 0.8;
      const yOffset = opts.yOffset ?? 0.12;

      const aura = new THREE.Mesh(
        new THREE.TorusGeometry(radius, thickness, 10, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      aura.rotation.x = Math.PI / 2;
      aura.position.copy(resolvePointRef(runtime, center));
      aura.position.y += yOffset;
      addVisualObject(runtime, aura);

      let age = 0;
      const updater = typeof runtime?.onUpdate === 'function'
        ? runtime.onUpdate((dt) => {
            if (!aura.parent) return false;
            age += dt;
            const p = 1 + Math.sin(age * 8) * pulse;
            aura.scale.setScalar(p);
            aura.rotation.z += spin * dt;
            const base = resolvePointRef(runtime, center);
            aura.position.copy(base);
            aura.position.y += yOffset;
            if (Number.isFinite(life) && life > 0) {
              const progress = clamp01(age / life);
              aura.material.opacity = opacity * (1 - progress);
              if (progress >= 1) {
                removeVisualObject(runtime, aura);
                return false;
              }
            }
            return true;
          })
        : null;

      return {
        object: aura,
        destroy() {
          if (typeof runtime?.removeOnUpdate === 'function' && updater) runtime.removeOnUpdate(updater);
          removeVisualObject(runtime, aura);
        },
      };
    },

    spawnTelegraphCone: (origin, direction, opts = {}) => {
      const o = toVec3(runtime, origin);
      const dir = normalizeDirection(runtime, direction);
      const range = Math.max(0.1, opts.range ?? 10);
      const angleDeg = Math.max(0.5, Math.min(179, opts.angleDeg ?? 22));
      const segments = Math.max(4, Math.floor(opts.segments ?? 18));
      const life = opts.life ?? 0.25;
      const opacity = clamp01(opts.opacity ?? 0.65);
      const color = opts.color ?? 0xffaa55;
      const y = opts.yOffset ?? 0.08;

      const points = [o.clone().add(new THREE.Vector3(0, y, 0))];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const ang = THREE.MathUtils.degToRad(-angleDeg + (2 * angleDeg * t));
        const v = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).multiplyScalar(range);
        points.push(o.clone().add(v).add(new THREE.Vector3(0, y, 0)));
      }
      points.push(o.clone().add(new THREE.Vector3(0, y, 0)));

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      addVisualObject(runtime, line);

      registerLifetime(runtime, life, ({ progress }) => {
        if (!line.parent) return false;
        line.material.opacity = opacity * (1 - progress);
        if (progress >= 1) {
          removeVisualObject(runtime, line);
          return false;
        }
        return true;
      });

      return line;
    },
  };

  return helpers;
}
