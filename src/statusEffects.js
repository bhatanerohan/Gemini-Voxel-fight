// src/statusEffects.js — Single source of truth for enemy status effects

export function createDefaultStatus() {
  return {
    freeze: 0,
    stun: 0,
    slowMult: 1,
    slowTime: 0,
    burnDps: 0,
    burnTime: 0,
    burnTick: 0.15,
    burnAcc: 0,
  };
}

export function clearStatus(s) {
  s.freeze = 0;
  s.stun = 0;
  s.slowMult = 1;
  s.slowTime = 0;
  s.burnDps = 0;
  s.burnTime = 0;
  s.burnTick = 0.15;
  s.burnAcc = 0;
  return s;
}

export function ensureStatus(e) {
  if (!e.status) {
    e.status = createDefaultStatus();
  }
  const s = e.status;
  if (typeof s.freeze !== 'number') s.freeze = 0;
  if (typeof s.stun !== 'number') s.stun = 0;
  if (typeof s.slowMult !== 'number') s.slowMult = 1;
  if (typeof s.slowTime !== 'number') s.slowTime = 0;
  if (typeof s.burnDps !== 'number') s.burnDps = 0;
  if (typeof s.burnTime !== 'number') s.burnTime = 0;
  if (typeof s.burnTick !== 'number') s.burnTick = 0.15;
  if (typeof s.burnAcc !== 'number') s.burnAcc = 0;
  return s;
}
