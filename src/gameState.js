// src/gameState.js — Central game state singleton with event bus

const initialState = {
  phase: 'playing', // 'menu' | 'playing' | 'forging' | 'waveBreak' | 'gameOver'
  wave: 0,
  score: 0,
  kills: 0,
  playerHp: 100,
  playerMaxHp: 100,
  isPaused: false,
  timeScale: 1,
};

const listeners = {};

export const GameState = {
  ...structuredClone(initialState),

  // ── Event Bus ──
  on(event, fn) {
    (listeners[event] ||= []).push(fn);
  },
  off(event, fn) {
    const arr = listeners[event];
    if (arr) listeners[event] = arr.filter(f => f !== fn);
  },
  emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  },

  // ── State transitions ──
  setPhase(phase) {
    const from = this.phase;
    if (from === phase) return;
    this.phase = phase;
    this.emit('phase_changed', { from, to: phase });
  },

  startWave(n) {
    this.wave = n;
    this.setPhase('playing');
    this.emit('wave_start', { wave: n });
  },

  endWave() {
    this.setPhase('waveBreak');
    this.emit('wave_clear', { wave: this.wave, kills: this.kills, score: this.score });
  },

  gameOver() {
    this.setPhase('gameOver');
    this.emit('game_over', { wave: this.wave, score: this.score, kills: this.kills });
  },

  addScore(pts) {
    this.score += pts;
    this.emit('score_change', { score: this.score, delta: pts });
  },

  addKill() {
    this.kills += 1;
    this.emit('enemy_killed_count', { kills: this.kills });
  },

  damagePlayer(amt) {
    this.playerHp = Math.max(0, this.playerHp - amt);
    this.emit('player_hit', { damage: amt, hpRemaining: this.playerHp });
    if (this.playerHp <= 0) {
      this.emit('player_death', {});
      this.gameOver();
    }
  },

  healPlayer(amt) {
    this.playerHp = Math.min(this.playerMaxHp, this.playerHp + amt);
  },

  restart() {
    Object.assign(this, structuredClone(initialState));
    // Clear all intervals/timeouts managed by game systems
    this.emit('restart', {});
  },
};
