// src/enemyIdentity.js — Enemy Identity System (WS-A5)
import { MatchMemory } from './matchMemory.js';
import { geminiJSON } from './geminiService.js';
import { GameState } from './gameState.js';

const usedNames = new Set();

const SYSTEM_PROMPT = `You are generating enemy identities for a voxel arena combat game. Each enemy gets a unique personality.

Rules:
- name: 1 word, 4-8 letters, alien/warrior sounding. Never repeat names within a match.
- epithet: short title like "the Bold", "Frostbitten", "Vex's Avenger"
- taunt: 1 short sentence the enemy says when spotting the player
- lastWords: 1 short dramatic sentence said on death
- grudge: null OR reference a fallen comrade by name (only after wave 2, 1-2 enemies max)
- resistance: null OR a weapon type like "freeze", "fire" (only if player favors a weapon type, 1 enemy max)
- personality: one of "reckless", "cautious", "vengeful"

Keep all text short — these display in small UI elements.

Respond with ONLY valid JSON in this format:
{
  "enemies": [
    { "name": "Kira", "epithet": "the Bold", "personality": "reckless", "taunt": "You'll fall like the rest!", "lastWords": "I didn't expect... the cold...", "grudge": null, "resistance": null }
  ]
}`;

export async function generateEnemyIdentities(wave, count) {
  try {
    const context = MatchMemory.buildGeminiContext();
    const fallenNames = MatchMemory.enemyDeaths
      .filter(d => d.name)
      .map(d => d.name);
    const usedList = Array.from(usedNames);

    const userMessage = `Wave ${wave}, generate ${count} enemy identities.

Match context: ${context}

Already used names (do NOT reuse): ${usedList.join(', ') || 'none'}
Recently fallen enemies: ${fallenNames.slice(-6).join(', ') || 'none'}

${wave >= 3 && fallenNames.length > 0 ? `1-2 enemies should have a grudge referencing a fallen comrade.` : 'No grudges needed yet.'}`;

    const result = await geminiJSON({
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      temperature: 1.0,
      maxTokens: 1500,
    });

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
}

export function getEnemyDisplayName(enemy) {
  return enemy.identity?.fullName || '';
}

// Reset used names on game restart
GameState.on('restart', () => usedNames.clear());
