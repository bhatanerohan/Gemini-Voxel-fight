// WS-12: Weapon Validation & Safety
// Best-effort safety net for AI-generated weapon code.

const DANGEROUS_PATTERNS = [
  { pattern: /\bfetch\s*\(/, label: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /\bimport\s*\(/, label: 'dynamic import()' },
  { pattern: /\bimport\s+/, label: 'import statement' },
  { pattern: /\brequire\s*\(/, label: 'require()' },
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bdocument\.cookie\b/, label: 'document.cookie' },
  { pattern: /\blocalStorage\b/, label: 'localStorage' },
  { pattern: /\bwindow\.location\b/, label: 'window.location' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket' },
  { pattern: /\bwhile\s*\(\s*true\s*\)/, label: 'while(true) infinite loop' },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: 'for(;;) infinite loop' },
  { pattern: /\b__proto__\b/, label: '__proto__ access' },
  { pattern: /\bconstructor\s*\.\s*constructor\b/, label: 'constructor.constructor access' },
  { pattern: /\bprototype\b/, label: 'prototype access' },
];

const MAX_CODE_LENGTH = 10000;

export function validateWeaponCode(code) {
  const errors = [];

  if (typeof code !== 'string' || code.length === 0) {
    return { valid: false, errors: ['Empty or invalid code'] };
  }

  if (code.length > MAX_CODE_LENGTH) {
    errors.push(`Code too long (${code.length} chars, max ${MAX_CODE_LENGTH})`);
  }

  for (const { pattern, label } of DANGEROUS_PATTERNS) {
    if (pattern.test(code)) {
      errors.push(`Dangerous pattern detected: ${label}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

const KNOWN_CTX_KEYS = new Set([
  'THREE', 'scene', 'player', 'getEnemies', 'spawn', 'addMesh', 'removeMesh',
  'addLight', 'removeLight', 'addObject', 'onUpdate', 'removeOnUpdate',
  'after', 'every', 'destroy', 'findEnemiesInCone', 'applyRadialForce',
  'createTrail', 'burstParticles', 'explode', 'raycast', 'elapsed', 'shake',
  'sdk',
]);

export function createSafeContext(ctx) {
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !KNOWN_CTX_KEYS.has(prop) && !(prop in target)) {
        console.warn(`[WeaponValidator] Unknown ctx property accessed: "${prop}"`);
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value) {
      console.warn(`[WeaponValidator] Blocked attempt to set ctx.${String(prop)}`);
      return true;
    },
  });
}
