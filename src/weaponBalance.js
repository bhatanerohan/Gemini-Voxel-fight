export const DEFAULT_WEAPON_TIER = 2;
export const DEFAULT_WEAPON_FIRE_MODE = 'instant';
export const CONTINUOUS_WEAPON_TICK_MS = 100;

export const INSTANT_WEAPON_COOLDOWNS_MS = Object.freeze({
  1: 100,
  2: 1000,
  3: 4000,
  4: 20000,
});

export const CONTINUOUS_WEAPON_CHANNEL_MS = Object.freeze({
  1: 4000,
  2: 3000,
  3: 2000,
  4: 1000,
});

export const CONTINUOUS_WEAPON_RECOVERY_MS = Object.freeze({
  1: 250,
  2: 1000,
  3: 4000,
  4: 20000,
});

export const WEAPON_TIER_LABELS = Object.freeze({
  1: 'Tier 1',
  2: 'Tier 2',
  3: 'Tier 3',
  4: 'Tier 4',
});

export const WEAPON_FIRE_MODE_LABELS = Object.freeze({
  instant: 'Instant',
  continuous: 'Continuous',
});

export const FIRE_PROFILE_OVERVIEW = [
  'Instant: T1 0.10s | T2 1.0s | T3 4.0s | T4 20s',
  'Continuous: T1 4.0s/0.25s | T2 3.0s/1.0s | T3 2.0s/4.0s | T4 1.0s/20s',
].join(' | ');

export function sanitizeWeaponTier(tier, fallback = DEFAULT_WEAPON_TIER) {
  const numeric = Number(tier);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 4) return numeric;
  return fallback;
}

export function sanitizeWeaponFireMode(fireMode, fallback = DEFAULT_WEAPON_FIRE_MODE) {
  const normalized = String(fireMode || '').trim().toLowerCase();
  if (normalized === 'continuous') return 'continuous';
  if (normalized === 'instant') return 'instant';
  return fallback;
}

export function getWeaponTierLabel(tier) {
  return WEAPON_TIER_LABELS[sanitizeWeaponTier(tier)] || WEAPON_TIER_LABELS[DEFAULT_WEAPON_TIER];
}

export function getWeaponFireModeLabel(fireMode) {
  return WEAPON_FIRE_MODE_LABELS[sanitizeWeaponFireMode(fireMode)] || WEAPON_FIRE_MODE_LABELS[DEFAULT_WEAPON_FIRE_MODE];
}

export function getInstantCooldownMsForTier(tier) {
  return INSTANT_WEAPON_COOLDOWNS_MS[sanitizeWeaponTier(tier)] || INSTANT_WEAPON_COOLDOWNS_MS[DEFAULT_WEAPON_TIER];
}

export function getContinuousChannelMsForTier(tier) {
  return CONTINUOUS_WEAPON_CHANNEL_MS[sanitizeWeaponTier(tier)] || CONTINUOUS_WEAPON_CHANNEL_MS[DEFAULT_WEAPON_TIER];
}

export function getContinuousRecoveryMsForTier(tier) {
  return CONTINUOUS_WEAPON_RECOVERY_MS[sanitizeWeaponTier(tier)] || CONTINUOUS_WEAPON_RECOVERY_MS[DEFAULT_WEAPON_TIER];
}

export function getWeaponFireProfile(tier, fireMode = DEFAULT_WEAPON_FIRE_MODE) {
  const resolvedTier = sanitizeWeaponTier(tier);
  const resolvedFireMode = sanitizeWeaponFireMode(fireMode);
  if (resolvedFireMode === 'continuous') {
    return {
      fireMode: resolvedFireMode,
      fireModeLabel: getWeaponFireModeLabel(resolvedFireMode),
      tier: resolvedTier,
      tierLabel: getWeaponTierLabel(resolvedTier),
      cooldownMs: getContinuousRecoveryMsForTier(resolvedTier),
      channelMs: getContinuousChannelMsForTier(resolvedTier),
      tickMs: CONTINUOUS_WEAPON_TICK_MS,
    };
  }

  return {
    fireMode: resolvedFireMode,
    fireModeLabel: getWeaponFireModeLabel(resolvedFireMode),
    tier: resolvedTier,
    tierLabel: getWeaponTierLabel(resolvedTier),
    cooldownMs: getInstantCooldownMsForTier(resolvedTier),
    channelMs: 0,
    tickMs: 0,
  };
}
