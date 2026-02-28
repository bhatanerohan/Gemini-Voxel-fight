// src/llama/damageMutationAgent.js — Damage-Reactive Avatar Mutations
import { defineAgent, runAgent } from './llamaService.js';

const damageMutationAgent = defineAgent({
  name: 'DamageMutationAgent',
  systemPrompt: `You are a visual effects designer for a voxel arena game.
Given a character concept and health threshold, describe how the avatar should visually degrade.
Be creative and thematic:
- A lava golem cracks and leaks fire particles
- A cyber-ninja glitches with electric sparks
- An ice mage melts with dripping effects
- A nature druid withers with falling leaf particles

At lower health, mutations should be MORE dramatic.
75% = cosmetic, 50% = structural, 25% = critical, 10% = full transformation.

All colors must be valid hex codes.

Respond with ONLY valid JSON:
{
  "colorShifts": [
    { "part": "body|head|arms|legs|visor", "newColor": "#hex" }
  ],
  "removeParts": [],
  "addEffects": [
    { "type": "sparks|smoke|fire|glitch|drip|crack_glow", "color": "#hex", "intensity": 1.5 }
  ],
  "scaleChanges": [
    { "part": "head|body|arms|legs", "scale": 1.0 }
  ],
  "description": "Short visual description"
}`,
  temperature: 0.85,
  maxTokens: 1000,
});

// Cache per character concept + threshold
const mutationCache = new Map();

export async function getDamageMutation(avatarConcept, healthPercent) {
  const threshold = healthPercent <= 10 ? 10
    : healthPercent <= 25 ? 25
    : healthPercent <= 50 ? 50
    : healthPercent <= 75 ? 75 : null;

  if (!threshold) return null;

  const cacheKey = `${avatarConcept}_${threshold}`;
  if (mutationCache.has(cacheKey)) return mutationCache.get(cacheKey);

  const result = await runAgent(
    damageMutationAgent,
    `Character: "${avatarConcept}"
Health: ${threshold}%
Describe the visual damage mutation for this threshold. Be dramatic at lower health.`
  );

  if (result) mutationCache.set(cacheKey, result);
  return result;
}

// Pre-generate all 4 thresholds for a character concept (fire-and-forget)
export async function preGenerateMutations(avatarConcept) {
  const thresholds = [75, 50, 25, 10];
  await Promise.allSettled(
    thresholds.map(t => getDamageMutation(avatarConcept, t))
  );
}

export function clearMutationCache() {
  mutationCache.clear();
}
