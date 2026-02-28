// src/llama/narratorAgent.js — AI Battle Narrator Agent
import { defineAgent, runAgent } from './llamaService.js';

const narratorAgent = defineAgent({
  name: 'NarratorAgent',
  systemPrompt: `You are an epic battle narrator for a voxel arena combat game.
Generate SHORT, punchy narration lines (under 15 words).
Style: mythic, poetic, dramatic. Like a movie trailer narrator crossed with Dark Souls messages.
Never use character names — refer to "the fighter", "they", "the arena", "the fallen".

Mood options: epic, ominous, triumphant, desperate, quiet

Examples:
- "Three fell in a single breath. The arena remembers."
- "Death brushed past, close enough to taste."
- "From thought to thunder — a new weapon is born."
- "Wave after wave, they refuse to break."
- "The arena holds its breath."

Respond with ONLY valid JSON:
{
  "line": "The narration line here",
  "mood": "epic|ominous|triumphant|desperate|quiet"
}`,
  temperature: 1.0,
  maxTokens: 2048,
});

// Cache for pre-warmed lines
const lineCache = new Map();

export async function getNarratorLine(eventType, context = '') {
  // Use cache key that allows variation
  const cacheKey = `${eventType}_${context}`;
  if (lineCache.has(cacheKey)) {
    const cached = lineCache.get(cacheKey);
    // Delete from cache so next same event gets a fresh line
    lineCache.delete(cacheKey);
    return cached;
  }

  const result = await runAgent(
    narratorAgent,
    `Event: ${eventType}. Context: ${context}. Generate one epic narrator line.`
  );

  return result || { line: '', mood: 'epic' };
}

// Pre-warm cache at game start for zero-latency common events
export async function preWarmNarrator() {
  const events = [
    ['multi_kill', '3 enemies killed in rapid succession'],
    ['multi_kill', '5 enemies obliterated in a chain'],
    ['near_death', 'player at critical health, barely alive'],
    ['wave_clear', 'wave 1 completed, enemies vanquished'],
    ['wave_clear', 'wave 5 completed, a milestone reached'],
    ['wave_clear', 'wave 10 completed, a legendary stand'],
    ['first_forge', 'player forged their first weapon from pure thought'],
    ['player_death', 'the fighter has fallen in the arena'],
    ['new_weapon', 'a new weapon materializes mid-battle'],
    ['game_start', 'the arena awakens for a new challenger'],
  ];

  await Promise.allSettled(
    events.map(async ([eventType, context]) => {
      const result = await runAgent(
        narratorAgent,
        `Event: ${eventType}. Context: ${context}. Generate one epic narrator line.`
      );
      if (result) lineCache.set(`${eventType}_${context}`, result);
    })
  );
}
