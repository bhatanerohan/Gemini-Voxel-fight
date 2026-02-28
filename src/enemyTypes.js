// src/enemyTypes.js — Enemy type definitions and wave composition

export const ENEMY_TYPES = {
  grunt: {
    name: 'Grunt',
    hp: 80,
    speed: 1.0,
    damage: 8,
    attackRange: 2.5,
    attackCooldown: 1.2,
    scale: 1.0,
    knockbackResist: 0,
    scoreValue: 100,
    colors: {
      suit: 0xff3344,
      accent: 0xffa07a,
      skin: 0xefbd96,
      visor: 0x1a0f10,
    },
  },
  charger: {
    name: 'Charger',
    hp: 120,
    speed: 1.8,
    damage: 15,
    attackRange: 3.0,
    attackCooldown: 2.5,
    scale: 0.9,
    knockbackResist: 0.2,
    scoreValue: 200,
    colors: {
      suit: 0xff8800,
      accent: 0xffcc44,
      skin: 0xefbd96,
      visor: 0x2a1500,
    },
    dash: {
      triggerRange: 12,
      speed: 30,
      duration: 0.4,
      cooldown: 4,
    },
  },
  tank: {
    name: 'Tank',
    hp: 300,
    speed: 0.5,
    damage: 20,
    attackRange: 3.5,
    attackCooldown: 2.0,
    scale: 1.4,
    knockbackResist: 0.7,
    scoreValue: 400,
    colors: {
      suit: 0x664488,
      accent: 0x9966cc,
      skin: 0xefbd96,
      visor: 0x1a0a20,
    },
  },
  ranged: {
    name: 'Ranged',
    hp: 60,
    speed: 0.8,
    damage: 12,
    attackRange: 25,
    attackCooldown: 1.8,
    preferredRange: 15,
    fleeRange: 6,
    scale: 0.85,
    knockbackResist: 0,
    scoreValue: 250,
    colors: {
      suit: 0x22aa44,
      accent: 0x66ff88,
      skin: 0xefbd96,
      visor: 0x0a200a,
    },
    projectile: {
      speed: 20,
      color: 0x44ff66,
      size: 0.15,
      damage: 12,
    },
  },
};

/**
 * Returns a weighted distribution of enemy types for a given wave.
 * Returns an object like { grunt: 0.6, charger: 0.3, ranged: 0.1 }
 * where values are probabilities summing to 1.
 */
export function getWaveComposition(wave) {
  if (wave <= 2) return { grunt: 1.0 };
  if (wave <= 4) return { grunt: 0.6, charger: 0.3, ranged: 0.1 };
  if (wave <= 7) return { grunt: 0.4, charger: 0.25, tank: 0.1, ranged: 0.25 };
  return { grunt: 0.3, charger: 0.25, tank: 0.2, ranged: 0.25 };
}

/**
 * Pick a random enemy type based on wave composition weights.
 */
export function pickEnemyType(wave) {
  const comp = getWaveComposition(wave);
  const rand = Math.random();
  let cumulative = 0;
  for (const [type, weight] of Object.entries(comp)) {
    cumulative += weight;
    if (rand <= cumulative) return type;
  }
  return 'grunt'; // fallback
}

/**
 * Get the type config for a given type name.
 */
export function getTypeConfig(typeName) {
  return ENEMY_TYPES[typeName] || ENEMY_TYPES.grunt;
}
