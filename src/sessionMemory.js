// src/sessionMemory.js — Cross-session persistence via localStorage
import { MatchMemory } from './matchMemory.js';
import { GameState } from './gameState.js';

const STORAGE_KEY = 'voxel-arena-sessions';
const MAX_SESSIONS = 10;

export function saveSessionSummary() {
  try {
    const summary = {
      date: new Date().toISOString(),
      wavesReached: MatchMemory.waves.length || GameState.wave,
      totalKills: GameState.kills,
      score: GameState.score,
      weaponsForged: MatchMemory.forgedWeapons.map(w => w.prompt),
      favoriteWeapon: MatchMemory.getPlayerProfile().favoriteWeaponType,
      notableEnemies: MatchMemory.enemyDeaths.filter(e => e.name).slice(-5).map(e => e.name),
    };
    const sessions = loadSessions();
    sessions.push(summary);
    // FIFO: keep only the last MAX_SESSIONS
    while (sessions.length > MAX_SESSIONS) sessions.shift();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (_) {
    // Silent fail — never crash the game for persistence
  }
}

export function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

export function buildSessionContext() {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    return "This is the player's first visit to the arena.";
  }

  const count = sessions.length;
  const best = sessions.reduce((a, b) => (b.wavesReached > a.wavesReached ? b : a), sessions[0]);
  const last = sessions[sessions.length - 1];
  const totalKillsAll = sessions.reduce((s, g) => s + (g.totalKills || 0), 0);

  // Collect favorite weapons across sessions
  const weaponCounts = {};
  for (const s of sessions) {
    if (s.favoriteWeapon && s.favoriteWeapon !== 'None') {
      weaponCounts[s.favoriteWeapon] = (weaponCounts[s.favoriteWeapon] || 0) + 1;
    }
  }
  const topWeapons = Object.entries(weaponCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([w]) => w);

  let ctx = `Returning player — ${count} past session(s).\n`;
  ctx += `Best run: wave ${best.wavesReached}, ${best.totalKills} kills, score ${best.score}.\n`;
  ctx += `Last run: wave ${last.wavesReached}, ${last.totalKills} kills.\n`;
  ctx += `Lifetime kills: ${totalKillsAll}.\n`;
  if (topWeapons.length > 0) {
    ctx += `Favorite weapons: ${topWeapons.join(', ')}.\n`;
  }

  return ctx;
}

export function isReturningPlayer() {
  return loadSessions().length > 0;
}
