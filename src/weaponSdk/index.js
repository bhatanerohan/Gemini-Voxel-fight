import { createDamageHelpers } from './damage.js';
import { createForceHelpers } from './force.js';
import { createStatusHelpers } from './status.js';
import { createTargetingHelpers } from './targeting.js';
import { createTimingHelpers } from './timing.js';
import { createVisualHelpers } from './visuals.js';

export const WEAPON_SDK_V1_HELPERS = [
  'findEnemiesInRadius',
  'findClosestEnemy',
  'findChainTargets',
  'findLineHits',
  'findEnemiesInLine',
  'damageEnemy',
  'damageRadius',
  'damageCone',
  'damageBeam',
  'applyStatus',
  'applyStatusRadius',
  'applyStatusCone',
  'applyForceToEnemy',
  'applyForceCone',
  'dampEnemiesInRadius',
  'spawnBeam',
  'spawnBolt',
  'spawnPulseRing',
  'spawnZoneAura',
  'spawnTelegraphCone',
  'spawnImpactBurst',
  'channel',
  'spawnZone',
  'spawnBeamTick',
];

// Standalone SDK factory.
// Intended to be wired into src/sandbox.js later by passing a runtime adapter.
export function createWeaponSdk(runtime) {
  const targeting = createTargetingHelpers(runtime);
  const damage = createDamageHelpers(runtime);
  const status = createStatusHelpers(runtime);
  const force = createForceHelpers(runtime);
  const visuals = createVisualHelpers(runtime);
  const timing = createTimingHelpers(runtime, { damage, status, force, visuals, targeting });

  return {
    ...targeting,
    ...damage,
    ...status,
    ...force,
    ...visuals,
    ...timing,
  };
}
