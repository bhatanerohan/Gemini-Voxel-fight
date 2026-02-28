// src/enemyIdentity.js — Enemy Identity System (Enhanced with LlamaIndex Agent)
import { MatchMemory } from './matchMemory.js';
import { GameState } from './gameState.js';
import { generateEnemyDesigns } from './llama/enemyDesignAgent.js';

const usedNames = new Set();

export async function generateEnemyIdentities(wave, count) {
  try {
    const context = MatchMemory.buildGeminiContext();
    const result = await generateEnemyDesigns(wave, count, context);

    if (!result?.enemies || !Array.isArray(result.enemies)) return [];

    // Validate and track names
    const identities = [];
    for (const e of result.enemies) {
      if (!e.name || typeof e.name !== 'string') continue;
      if (usedNames.has(e.name.toLowerCase())) continue;
      usedNames.add(e.name.toLowerCase());
      identities.push(e);
    }

    return identities;
  } catch (err) {
    console.warn('[enemyIdentity] Failed to generate identities:', err);
    return [];
  }
}

export function applyIdentity(enemy, identity) {
  const fullName = `${identity.name} ${identity.epithet || ''}`.trim();
  enemy.identity = {
    name: identity.name,
    epithet: identity.epithet || '',
    fullName,
    taunt: identity.taunt || null,
    lastWords: identity.lastWords || null,
    grudge: identity.grudge || null,
    resistance: identity.resistance || null,
    personality: identity.personality || 'reckless',
    hasTaunted: false,
  };

  // Apply AI-generated visual config if present
  if (identity.visual) {
    try {
      const v = identity.visual;
      if (v.primaryColor && enemy.bodyMesh?.material) {
        enemy.bodyMesh.material.color.set(v.primaryColor);
      }
      if (v.glowColor && enemy.bodyMesh?.material?.emissive) {
        enemy.bodyMesh.material.emissive.set(v.glowColor);
        enemy.bodyMesh.material.emissiveIntensity = 0.15;
      }
      // Apply visor color
      const rig = enemy.mesh?.userData?.rig;
      if (rig?.visor?.material && v.visorColor) {
        rig.visor.material.color.set(v.visorColor);
        rig.visor.material.emissive.set(v.visorColor);
        rig.visor.material.emissiveIntensity = 0.3;
      }
      // Apply scale
      if (v.scale && rig?.root) {
        rig.root.scale.setScalar(Math.min(2, Math.max(0.7, v.scale)));
      }
    } catch (e) {
      // Silently ignore visual errors — gameplay continues
    }
  }
}

export function getEnemyDisplayName(enemy) {
  return enemy.identity?.fullName || '';
}

// Reset used names on game restart
GameState.on('restart', () => usedNames.clear());
