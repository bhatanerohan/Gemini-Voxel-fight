import { normalizeDirection, resolvePointRef } from './utils.js';

export function createTimingHelpers(runtime, deps) {
  const { damage, status, force, visuals, targeting } = deps;

  function channel(opts = {}) {
    if (typeof runtime?.onUpdate !== 'function') {
      throw new Error('weaponSdk.channel requires runtime.onUpdate');
    }

    const duration = Math.max(0.001, opts.duration ?? 0.5);
    const tick = Math.max(0, opts.tick ?? 0);
    let age = 0;
    let tickAcc = 0;
    let stopped = false;

    const cb = runtime.onUpdate((dt, elapsed) => {
      if (stopped) return false;
      age += dt;
      tickAcc += dt;
      const progress = Math.min(1, age / duration);

      if (typeof opts.onUpdate === 'function') {
        opts.onUpdate({ dt, elapsed, age, duration, progress });
      }

      if (tick > 0 && typeof opts.onTick === 'function') {
        while (tickAcc >= tick) {
          tickAcc -= tick;
          opts.onTick({ dt: tick, elapsed, age, duration, progress });
        }
      }

      if (age >= duration) {
        if (tick <= 0 && typeof opts.onTick === 'function') {
          opts.onTick({ dt, elapsed, age, duration, progress: 1 });
        }
        if (typeof opts.onEnd === 'function') opts.onEnd({ elapsed, age, duration });
        return false;
      }

      return true;
    });

    return {
      stop() {
        stopped = true;
        if (typeof runtime?.removeOnUpdate === 'function' && cb) runtime.removeOnUpdate(cb);
      },
    };
  }

  return {
    channel,

    spawnZone: (opts = {}) => {
      const radius = Math.max(0.1, opts.radius ?? 4);
      const duration = Math.max(0.05, opts.duration ?? 1);
      const tick = Math.max(0.01, opts.tick ?? 0.1);
      const effects = opts.effects || {};
      const visualSpec = opts.visual;

      const aura = visualSpec === false ? null : visuals?.spawnZoneAura?.(opts.center, {
        radius,
        life: duration,
        color: visualSpec?.color ?? opts.color,
        opacity: visualSpec?.opacity,
        thickness: visualSpec?.thickness,
      });

      const h = channel({
        duration,
        tick,
        onTick: (info) => {
          const center = resolvePointRef(runtime, opts.center);
          if (effects.damage && damage?.damageRadius) {
            damage.damageRadius(center, { radius, ...effects.damage });
          }
          if (effects.status && status?.applyStatusRadius) {
            status.applyStatusRadius(center, { radius, ...effects.status });
          }
          if (effects.radialForce && typeof runtime?.applyRadialForce === 'function') {
            runtime.applyRadialForce(center, { radius, ...effects.radialForce });
          }
          if (effects.damp && force?.dampEnemiesInRadius) {
            force.dampEnemiesInRadius(center, { radius, ...effects.damp });
          }
          if (typeof opts.onTick === 'function') {
            opts.onTick({ ...info, center, radius });
          }
        },
        onEnd: (info) => {
          if (typeof opts.onEnd === 'function') opts.onEnd(info);
        },
      });

      return {
        ...h,
        aura,
        destroy() {
          h.stop();
          aura?.destroy?.();
        },
      };
    },

    spawnBeamTick: (opts = {}) => {
      const duration = Math.max(0.05, opts.duration ?? 0.35);
      const tick = Math.max(0.01, opts.tick ?? 0.08);
      const range = Math.max(0.1, opts.range ?? 16);
      const effects = opts.effects || {};
      const beamVisual = opts.visual !== false;
      const beamVisualOpts = typeof opts.visual === 'object' ? opts.visual : {};
      const stopOnHit = opts.stopOnHit ?? (!opts.pierce);
      const endpointMode = opts.endpointMode ?? (stopOnHit ? 'firstHit' : 'fullRange');

      return channel({
        duration,
        tick,
        onTick: (info) => {
          const origin = resolvePointRef(runtime, opts.origin);
          const dir = normalizeDirection(runtime, typeof opts.direction === 'function' ? opts.direction() : opts.direction);
          const beamWidth = Math.max(0, beamVisualOpts.width ?? effects.damageBeam?.width ?? opts.width ?? 0.08);

          let hits = [];
          if (targeting?.findLineHits) {
            hits = targeting.findLineHits(origin, dir, {
              range,
              width: beamWidth,
              max: opts.pierce ? (opts.maxHits ?? Infinity) : 1,
              sortBy: 'along',
              ignoreY: opts.ignoreY,
              inflate: opts.hitInflate ?? beamVisualOpts.hitInflate ?? 0.25,
              targetRadius: opts.targetRadius,
            }) || [];
          }

          const firstHit = hits[0] || null;
          const lastHit = hits[hits.length - 1] || null;

          let end = origin.clone().add(dir.clone().multiplyScalar(range));
          if (endpointMode === 'firstHit' && firstHit) end = firstHit.point.clone();
          else if (endpointMode === 'lastHit' && lastHit) end = lastHit.point.clone();

          const effectiveRange = (stopOnHit && firstHit) ? Math.max(0.05, firstHit.t) : range;

          if (beamVisual && visuals?.spawnBeam) {
            visuals.spawnBeam(origin, end, {
              color: beamVisualOpts.color,
              width: beamWidth,
              life: beamVisualOpts.life ?? Math.min(0.08, tick * 0.9),
              jitter: beamVisualOpts.jitter ?? 0,
              opacity: beamVisualOpts.opacity,
            });
          }

          if (effects.damageBeam && damage?.damageBeam) {
            const damageOpts = { range: effectiveRange, ...effects.damageBeam };
            if (stopOnHit && damageOpts.max == null) damageOpts.max = 1;
            damage.damageBeam(origin, dir, damageOpts);
          }
          if (effects.damageCone && damage?.damageCone) {
            damage.damageCone(origin, dir, { range: effectiveRange, ...effects.damageCone });
          }
          if (effects.statusCone && status?.applyStatusCone) {
            status.applyStatusCone(origin, dir, { range: effectiveRange, ...effects.statusCone });
          }
          if (effects.forceCone && force?.applyForceCone) {
            force.applyForceCone(origin, dir, { range: effectiveRange, ...effects.forceCone });
          }

          if (typeof opts.onTick === 'function') {
            opts.onTick({ ...info, origin, dir, end, hits, firstHit, lastHit, effectiveRange });
          }
        },
      });
    },
  };
}
