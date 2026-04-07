const GRAPHICS_STORAGE_KEY = 'voxel-arena-graphics';
const GRAPHICS_LEVELS = ['low', 'medium', 'high'];
const GRAPHICS_PRESETS = {
  low: {
    label: 'Low',
    shortLabel: 'LOW',
    pixelRatioCap: 1,
    bloom: false,
    bloomStrength: 0,
    bloomRadius: 0,
    bloomThreshold: 1,
    shadows: false,
    shadowMapSize: 512,
    labelHz: 12,
    maxWeaponLights: 2,
  },
  medium: {
    label: 'Medium',
    shortLabel: 'MED',
    pixelRatioCap: 1.25,
    bloom: true,
    bloomStrength: 0.58,
    bloomRadius: 0.24,
    bloomThreshold: 0.32,
    shadows: true,
    shadowMapSize: 1024,
    labelHz: 24,
    maxWeaponLights: 5,
  },
  high: {
    label: 'High',
    shortLabel: 'HIGH',
    pixelRatioCap: 1.75,
    bloom: true,
    bloomStrength: 0.8,
    bloomRadius: 0.3,
    bloomThreshold: 0.3,
    shadows: true,
    shadowMapSize: 2048,
    labelHz: 60,
    maxWeaponLights: 10,
  },
};

function readStoredGraphicsLevel(storage) {
  try {
    return storage?.getItem?.(GRAPHICS_STORAGE_KEY) ?? null;
  } catch (err) {
    return null;
  }
}

function writeStoredGraphicsLevel(storage, level) {
  try {
    storage?.setItem?.(GRAPHICS_STORAGE_KEY, level);
  } catch (err) {}
}

export function normalizeGraphicsLevel(level) {
  const normalized = typeof level === 'string' ? level.trim().toLowerCase() : '';
  return GRAPHICS_LEVELS.includes(normalized) ? normalized : null;
}

export function resolveInitialGraphicsLevel({
  search = '',
  storage = typeof window !== 'undefined' ? window.localStorage : null,
} = {}) {
  const params = new URLSearchParams(search);
  return (
    normalizeGraphicsLevel(params.get('gfx'))
    || normalizeGraphicsLevel(params.get('graphics'))
    || normalizeGraphicsLevel(readStoredGraphicsLevel(storage))
    || 'medium'
  );
}

function buildGraphicsSettings(level) {
  const preset = GRAPHICS_PRESETS[level];
  return {
    level,
    ...preset,
    labelInterval: preset.labelHz > 0 ? 1 / preset.labelHz : 0,
  };
}

export function createGraphicsController({
  initialLevel = 'medium',
  storage = typeof window !== 'undefined' ? window.localStorage : null,
  onApply = () => {},
} = {}) {
  let currentLevel = normalizeGraphicsLevel(initialLevel) || 'medium';
  let settings = buildGraphicsSettings(currentLevel);
  let pendingLabelRefresh = true;
  let labelUpdateAccumulator = settings.labelInterval;

  const apply = (level, { persist = true } = {}) => {
    currentLevel = normalizeGraphicsLevel(level) || 'medium';
    settings = buildGraphicsSettings(currentLevel);
    if (persist) writeStoredGraphicsLevel(storage, currentLevel);
    pendingLabelRefresh = true;
    labelUpdateAccumulator = settings.labelInterval;
    onApply({ level: currentLevel, settings });
    return settings;
  };

  return {
    get level() {
      return currentLevel;
    },
    get settings() {
      return settings;
    },
    apply,
    cycle() {
      const currentIndex = GRAPHICS_LEVELS.indexOf(currentLevel);
      const nextLevel = GRAPHICS_LEVELS[(currentIndex + 1) % GRAPHICS_LEVELS.length];
      return apply(nextLevel);
    },
    shouldRefreshLabels(dt) {
      if (settings.labelHz <= 0) return false;
      labelUpdateAccumulator += dt;
      if (!pendingLabelRefresh && labelUpdateAccumulator < settings.labelInterval) return false;
      pendingLabelRefresh = false;
      labelUpdateAccumulator = 0;
      return true;
    },
    formatPerformanceHudText(fps) {
      const fpsLabel = Number.isFinite(fps) && fps > 0 ? Math.round(fps) : '--';
      return `FPS ${fpsLabel} | ${settings.shortLabel}`;
    },
    buildHudText() {
      return `WASD move | Space jump | 1-4 switch weapons | Hold click fire | T forge panel | G graphics ${settings.label}`;
    },
  };
}
