// src/sessionMemory.js — Cross-session persistence via localStorage
import { MatchMemory } from './matchMemory.js';
import { GameState } from './gameState.js';

const STORAGE_KEY = 'voxel-arena-sessions';
const MAX_SESSIONS = 10;

export function saveSessionSummary() {
  try {
    const playerProfile = MatchMemory.getPlayerProfile();
    const summary = {
      date: new Date().toISOString(),
      wavesReached: MatchMemory.waves.length || GameState.wave,
      totalKills: GameState.kills,
      score: GameState.score,
      weaponsForged: MatchMemory.forgedWeapons.map(w => w.prompt),
      favoriteWeapon: playerProfile.favoriteWeaponType,
      playstyle: playerProfile.playstyle,
      movementHabits: MatchMemory.getMovementHabits(),
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

export function buildBossLearningProfile() {
  const sessions = loadSessions();
  if (sessions.length === 0) {
    return {
      sampleSize: 0,
      aggression: 0.5,
      strafeBias: 0.25,
      sprintBias: 0.2,
      closeRangeBias: 0.3,
      longRangeBias: 0.35,
      preferredWeapon: 'None',
    };
  }

  let strafe = 0;
  let sprint = 0;
  let closeRange = 0;
  let longRange = 0;
  let aggressiveRuns = 0;
  let defensiveRuns = 0;
  const weaponCounts = {};
  const used = sessions.length;

  for (const s of sessions) {
    const m = s.movementHabits || {};
    strafe += Number.isFinite(m.strafeRatio) ? m.strafeRatio : 0.25;
    sprint += Number.isFinite(m.sprintRatio) ? m.sprintRatio : 0.2;
    closeRange += Number.isFinite(m.closeRangeRatio) ? m.closeRangeRatio : 0.3;
    longRange += Number.isFinite(m.longRangeRatio) ? m.longRangeRatio : 0.35;
    if (s.playstyle === 'aggressive') aggressiveRuns++;
    else defensiveRuns++;
    if (s.favoriteWeapon && s.favoriteWeapon !== 'None') {
      weaponCounts[s.favoriteWeapon] = (weaponCounts[s.favoriteWeapon] || 0) + 1;
    }
  }

  const preferredWeapon = Object.entries(weaponCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
  const aggression = aggressiveRuns / Math.max(1, aggressiveRuns + defensiveRuns);

  return {
    sampleSize: used,
    aggression,
    strafeBias: Math.max(0, Math.min(1, strafe / used)),
    sprintBias: Math.max(0, Math.min(1, sprint / used)),
    closeRangeBias: Math.max(0, Math.min(1, closeRange / used)),
    longRangeBias: Math.max(0, Math.min(1, longRange / used)),
    preferredWeapon,
  };
}
