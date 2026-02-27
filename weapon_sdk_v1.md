# Weapon SDK v1 (Draft)

This file defines the planned reusable weapon helper surface for the web game runtime.

Goal:
- Stop adding per-weapon helpers
- Expose generic targeting/mechanics/visual primitives
- Let the LLM compose these primitives deterministically

Status:
- `src/weaponSdk/` has been created as a standalone SDK module set (not yet wired into `src/sandbox.js`)
- The API below is the first draft surface (`v1`) and can be refined before runtime exposure

## File Layout

- `src/weaponSdk/index.js` - SDK factory (`createWeaponSdk(runtime)`)
- `src/weaponSdk/targeting.js` - target queries
- `src/weaponSdk/damage.js` - damage helpers
- `src/weaponSdk/status.js` - status application helpers
- `src/weaponSdk/force.js` - force/control helpers
- `src/weaponSdk/visuals.js` - reusable visual primitives
- `src/weaponSdk/timing.js` - channel/zone/ticking helpers
- `src/weaponSdk/utils.js` - shared math/runtime adapters

## Runtime Adapter Contract (for later wiring)

`createWeaponSdk(runtime)` expects a runtime adapter object that provides the sandbox/runtime services.

Minimum adapter fields:

- `THREE`
- `getEnemies()` -> wrapped enemy list
- `toVec3(v)` (optional; SDK falls back to local conversion)
- `onUpdate(fn)` and `removeOnUpdate(fn)` (for timed visuals/zones)
- `addMesh/removeMesh` and/or `addObject`
- `burstParticles(opts)` (optional for `spawnImpactBurst`)
- `addLight/removeLight` (optional for burst light flashes)

Recommended adapter fields:

- `baseFindEnemiesInCone(origin, direction, opts)` (delegate to current sandbox cone helper)
- `applyRadialForce(center, opts)` (used by `spawnZone` field effects)

## Helper Inventory (v1 Draft)

### Targeting

- `findEnemiesInRadius(center, { radius=8, max, sortBy='distance' })`
- `findClosestEnemy(point, { maxRange=Infinity })`
- `findChainTargets(startEnemyOrPoint, { jumpRadius=8, maxJumps=4, fromDirection })`
- `findLineHits(origin, direction, { range=20, width=1, max, sortBy='along' })`
- `findEnemiesInLine(origin, direction, { range=20, width=1, max, sortBy='distance' })`

`findLineHits(...)` returns metadata for beam/ray endpoint coupling:

```js
[{ enemy, t, distToLine, point }]
```

- `t` = distance along the line from origin
- `distToLine` = perpendicular distance from line center
- `point` = closest point on the line segment

### Damage

- `damageEnemy(enemy, { damage })` (also accepts `damageEnemy(enemy, number)`)
- `damageRadius(center, { radius=6, damage=10, falloff='linear'|'none'|'quadratic'|'smooth', max, sortBy })`
- `damageCone(origin, direction, { range=12, angleDeg=22, damage=8, falloff='linear', max, sortBy })`
- `damageBeam(origin, direction, { range=18, width=1, damage=10, falloff='none', max, sortBy })`

Returns for area damage helpers:

```js
{ count, totalDamage, targets }
```

### Status

- `applyStatus(enemy, { freeze, stun, slow, ignite, slowSeconds, duration })`
- `applyStatusRadius(center, { radius, ...statusSpec })`
- `applyStatusCone(origin, direction, { range, angleDeg, ...statusSpec })`

Status spec notes:

- `freeze`: seconds (number)
- `stun`: seconds (number)
- `slow`: either number multiplier (`0..1`) or `{ multiplier, seconds }`
- `ignite`: object passed to `enemy.ignite(...)`, or `true` for defaults

### Force / Control

- `applyForceToEnemy(enemy, { x, y, z, direction, strength, lift, maxMagnitude })`
- `applyForceCone(origin, direction, { range=10, angleDeg=22, strength=8, lift=0, falloff='linear', alignToTarget=false, max, sortBy })`
- `dampEnemiesInRadius(center, { radius=8, multiplier=0.8, includeY=false, max, sortBy })`

### Visuals

- `spawnBeam(start, end, { color, width, life, jitter, opacity })`
- `spawnBolt(start, end, { color, life, segments, zigzag, flicker, opacity })`
- `spawnPulseRing(center, { radius, color, life, width, opacity, yOffset })`
- `spawnZoneAura(centerRef, { radius, thickness, color, life, opacity, pulse, spin, yOffset })`
- `spawnTelegraphCone(origin, direction, { range, angleDeg, color, life, opacity, yOffset })`
- `spawnImpactBurst(position, { color, particles/count, speed, lifetime, size, gravity, light, lightIntensity, ringRadius })`

Notes:
- `centerRef` may be a `Vector3`, object with `position`, object with `mesh.position`, or a function returning a point.
- Visuals are lightweight and intended as reusable primitives, not final weapon-specific looks.

### Timing / Zones

- `channel({ duration, tick, onUpdate, onTick, onEnd })`
- `spawnZone({ center, radius, duration, tick, effects, visual, onTick, onEnd })`
- `spawnBeamTick({ origin, direction, range, duration, tick, effects, visual, onTick })`

`spawnZone().effects` supports composition:

- `damage` -> uses `damageRadius`
- `status` -> uses `applyStatusRadius`
- `radialForce` -> uses runtime `applyRadialForce` if provided
- `damp` -> uses `dampEnemiesInRadius`

## Why This Helps

- Reduces archetype mixing (freeze weapon accidentally behaving like black hole)
- Centralizes damage/status/force behavior
- Makes constraints easier to enforce later (range/damage/force caps can be clamped in one place)
- Lets the LLM focus on composition + parameter choices, not reinvention

## Next Step (Recommended)

Wire the SDK into `src/sandbox.js` using a runtime adapter and expose the helpers on `ctx`, then update `src/prompt.js` to prefer these helpers over ad hoc logic.
