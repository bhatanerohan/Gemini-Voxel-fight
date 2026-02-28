// src/matchMemory.js — Centralized match event log for Gemini context
import { GameState } from './gameState.js';

const MAX_RECENT_DEATHS = 30;
const MAX_EVENTS = 200;
const MULTI_KILL_WINDOW = 1.5; // seconds

export const MatchMemory = {
  events: [],
  waves: [],
  forgedWeapons: [],
  enemyDeaths: [],
  currentWave: null,
  _matchStart: Date.now(),
  _recentKillTimestamps: [],
  _notableMoments: [],
  _activeWeaponGetter: null,
  _movement: {
    combatTime: 0,
    strafingTime: 0,
    sprintTime: 0,
    forwardTime: 0,
    backwardTime: 0,
    closeRangeTime: 0,
    midRangeTime: 0,
    longRangeTime: 0,
  },

  /** Register a function that returns the current weapon name */
  setWeaponGetter(fn) {
    this._activeWeaponGetter = fn;
  },

  _getWeaponName() {
    if (typeof this._activeWeaponGetter === 'function') {
      try { return this._activeWeaponGetter() || 'Unknown'; } catch (_) {}
    }
    return 'Unknown';
  },

  _now() {
    return (Date.now() - this._matchStart) / 1000;
  },

  logEvent(type, data) {
    const entry = { type, data, timestamp: this._now(), wave: GameState.wave };
    this.events.push(entry);
    // Cap events array
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS);
    }
  },

  recordWaveStart(wave, playerHp = 100) {
    this.currentWave = {
      wave,
      startTime: this._now(),
      kills: 0,
      weaponsUsed: new Set(),
      playerHpStart: playerHp,
    };
    this.logEvent('wave_start', { wave });
  },

  recordWaveClear(wave) {
    const cw = this.currentWave;
    if (cw && cw.wave === wave) {
      const summary = {
        wave: cw.wave,
        duration: Math.round(this._now() - cw.startTime),
        kills: cw.kills,
        weaponsUsed: Array.from(cw.weaponsUsed),
        playerHpEnd: cw._lastKnownHp ?? 100,
      };
      this.waves.push(summary);
      this.logEvent('wave_clear', summary);
    }
    this.currentWave = null;
  },

  recordEnemyKill(enemy) {
    const weaponName = this._getWeaponName();
    const now = this._now();

    const deathEntry = {
      name: enemy.identity?.name || null,
      type: enemy.typeConfig?.type || 'grunt',
      killedBy: weaponName,
      wave: GameState.wave,
      lastWords: enemy.identity?.lastWords || null,
    };
    this.enemyDeaths.push(deathEntry);

    // Cap deaths
    if (this.enemyDeaths.length > MAX_RECENT_DEATHS) {
      this.enemyDeaths.splice(0, this.enemyDeaths.length - MAX_RECENT_DEATHS);
    }

    // Track current wave kills
    if (this.currentWave) {
      this.currentWave.kills++;
      this.currentWave.weaponsUsed.add(weaponName);
    }

    // Track weapon kill counts
    const fw = this.forgedWeapons.find(w => w.prompt === weaponName);
    if (fw) fw.killCount++;

    // Multi-kill detection
    this._recentKillTimestamps.push(now);
    this._recentKillTimestamps = this._recentKillTimestamps.filter(
      t => now - t <= MULTI_KILL_WINDOW
    );
    if (this._recentKillTimestamps.length >= 2) {
      // Only log when we cross a threshold (2, 3, 4, etc.)
      const count = this._recentKillTimestamps.length;
      const lastMoment = this._notableMoments[this._notableMoments.length - 1];
      if (!lastMoment || lastMoment.type !== 'multi_kill' || now - lastMoment._time > MULTI_KILL_WINDOW) {
        this._notableMoments.push({
          type: 'multi_kill', count, wave: GameState.wave, weapon: weaponName, _time: now,
        });
      } else if (lastMoment.type === 'multi_kill') {
        lastMoment.count = count;
        lastMoment._time = now;
      }
      if (this._recentKillTimestamps.length >= 3) {
        GameState.emit('multi_kill', { count: this._recentKillTimestamps.length, wave: GameState.wave });
      }
    }

    this.logEvent('enemy_kill', { name: deathEntry.name, type: deathEntry.type, killedBy: weaponName });
  },

  recordWeaponForge(prompt) {
    this.forgedWeapons.push({
      prompt,
      waveForged: GameState.wave,
      killCount: 0,
    });
    this.logEvent('weapon_forge', { prompt, wave: GameState.wave });
    if (this.forgedWeapons.length === 1) {
      GameState.emit('first_forge', { prompt });
    }
  },

  recordPlayerHit(damage, hpRemaining) {
    this.logEvent('player_hit', { damage, hpRemaining });
    if (this.currentWave) this.currentWave._lastKnownHp = hpRemaining;
    if (hpRemaining > 0 && hpRemaining < 15) {
      this._notableMoments.push({
        type: 'near_death', hp: hpRemaining, wave: GameState.wave, _time: this._now(),
      });
      GameState.emit('player_near_death', { hp: hpRemaining, wave: GameState.wave });
    }
  },

  recordPlayerMovement({ dt = 0, speed = 0, localForward = 0, localRight = 0, sprinting = false, nearestEnemyDist = Infinity } = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (GameState.phase !== 'playing') return;
    if (nearestEnemyDist > 35) return;

    this._movement.combatTime += dt;

    if (Math.abs(localRight) > Math.abs(localForward) * 0.7 && speed > 0.8) this._movement.strafingTime += dt;
    if (sprinting && speed > 1.2) this._movement.sprintTime += dt;
    if (localForward > 0.2) this._movement.forwardTime += dt;
    if (localForward < -0.2) this._movement.backwardTime += dt;

    if (nearestEnemyDist < 8) this._movement.closeRangeTime += dt;
    else if (nearestEnemyDist < 18) this._movement.midRangeTime += dt;
    else this._movement.longRangeTime += dt;
  },

  getMovementHabits() {
    const combatTime = Math.max(0.001, this._movement.combatTime);
    const totalRange = Math.max(
      0.001,
      this._movement.closeRangeTime + this._movement.midRangeTime + this._movement.longRangeTime
    );
    return {
      combatTime: Math.round(this._movement.combatTime),
      strafeRatio: this._movement.strafingTime / combatTime,
      sprintRatio: this._movement.sprintTime / combatTime,
      forwardRatio: this._movement.forwardTime / combatTime,
      backwardRatio: this._movement.backwardTime / combatTime,
      closeRangeRatio: this._movement.closeRangeTime / totalRange,
      midRangeRatio: this._movement.midRangeTime / totalRange,
      longRangeRatio: this._movement.longRangeTime / totalRange,
    };
  },

  buildGeminiContext() {
    const matchDuration = Math.round(this._now());
    const profile = this.getPlayerProfile();
    const movementHabits = this.getMovementHabits();

    const waveSummaries = this.waves.map(w => ({
      wave: w.wave,
      duration: w.duration,
      kills: w.kills,
      weaponUsed: w.weaponsUsed[0] || 'None',
      playerHpEnd: w.playerHpEnd,
    }));

    const forged = this.forgedWeapons.map(w => ({
      prompt: w.prompt,
      wave: w.waveForged,
      totalKills: w.killCount,
    }));

    // Last 10 deaths only
    const recentDeaths = this.enemyDeaths.slice(-10).map(d => ({
      name: d.name,
      type: d.type,
      killedBy: d.killedBy,
      wave: d.wave,
    }));

    const notableMoments = this._notableMoments.slice(-10).map(m => {
      const { _time, ...rest } = m;
      return rest;
    });

    const ctx = {
      matchDuration,
      currentWave: GameState.wave,
      playerProfile: profile,
      movementHabits,
      waveSummaries,
      forgedWeapons: forged,
      recentDeaths,
      notableMoments,
    };

    return JSON.stringify(ctx);
  },

  buildWaveSummary(waveNum) {
    const w = this.waves.find(ws => ws.wave === waveNum);
    if (!w) return `Wave ${waveNum}: no data`;
    return `Wave ${w.wave}: ${w.kills} kills in ${w.duration}s, ended at ${w.playerHpEnd} HP, weapons: ${w.weaponsUsed.join(', ')}`;
  },

  getPlayerProfile() {
    // Find most-used weapon by kill count
    let favoriteWeaponType = 'None';
    let maxKills = 0;
    for (const w of this.forgedWeapons) {
      if (w.killCount > maxKills) {
        maxKills = w.killCount;
        favoriteWeaponType = w.prompt;
      }
    }

    // Playstyle: count hits taken vs kills dealt
    const totalKills = this.enemyDeaths.length;
    const hitsReceived = this.events.filter(e => e.type === 'player_hit').length;
    const playstyle = totalKills > 0 && hitsReceived / totalKills < 0.3 ? 'aggressive' : 'defensive';

    return {
      favoriteWeaponType,
      playstyle,
      weaponVariety: this.forgedWeapons.length,
    };
  },

  reset() {
    this.events = [];
    this.waves = [];
    this.forgedWeapons = [];
    this.enemyDeaths = [];
    this.currentWave = null;
    this._matchStart = Date.now();
    this._recentKillTimestamps = [];
    this._notableMoments = [];
    this._movement = {
      combatTime: 0,
      strafingTime: 0,
      sprintTime: 0,
      forwardTime: 0,
      backwardTime: 0,
      closeRangeTime: 0,
      midRangeTime: 0,
      longRangeTime: 0,
    };
  },
};

// Auto-reset on game restart
GameState.on('restart', () => MatchMemory.reset());
