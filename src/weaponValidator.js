// WS-12: Weapon Validation & Safety
// Best-effort safety net for AI-generated weapon code.
// NOTE: Regex-based validation cannot fully prevent sandbox escapes.
// For production use, weapon code should run in a Web Worker or sandboxed iframe.

const DANGEROUS_PATTERNS = [
  // Network access
  { pattern: /\bfetch\s*\(/, label: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket' },
  { pattern: /\bsendBeacon\b/, label: 'sendBeacon' },
  { pattern: /\bEventSource\b/, label: 'EventSource' },

  // Module/eval
  { pattern: /\bimport\s*\(/, label: 'dynamic import()' },
  { pattern: /\bimport\s+/, label: 'import statement' },
  { pattern: /\brequire\s*\(/, label: 'require()' },
  { pattern: /\beval\s*\(/, label: 'eval()' },
  { pattern: /\bFunction\s*\(/, label: 'Function constructor' },

  // Sensitive APIs
  { pattern: /\bdocument\.cookie\b/, label: 'document.cookie' },
  { pattern: /\blocalStorage\b/, label: 'localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
  { pattern: /\bindexedDB\b/, label: 'indexedDB' },
  { pattern: /\bwindow\.location\b/, label: 'window.location' },
  { pattern: /\blocation\s*\.\s*href\b/, label: 'location.href' },
  { pattern: /\bwindow\s*\.\s*open\b/, label: 'window.open' },
  { pattern: /\bnavigator\b/, label: 'navigator access' },

  // Global escapes
  { pattern: /\bglobalThis\b/, label: 'globalThis' },
  { pattern: /\bself\b/, label: 'self' },
  { pattern: /\btop\b/, label: 'top' },
  { pattern: /\bparent\b/, label: 'parent' },
  { pattern: /\bframes\b/, label: 'frames' },

  // DOM manipulation (beyond what ctx provides)
  { pattern: /\bdocument\s*\./, label: 'document access' },
  { pattern: /\bdocument\s*\[/, label: 'document bracket access' },
  { pattern: /\binnerHTML\b/, label: 'innerHTML' },
  { pattern: /\bouterHTML\b/, label: 'outerHTML' },

  // Prototype pollution
  { pattern: /\b__proto__\b/, label: '__proto__ access' },
  { pattern: /\bconstructor\s*\.\s*constructor\b/, label: 'constructor.constructor access' },
  { pattern: /\bgetPrototypeOf\b/, label: 'getPrototypeOf' },
  { pattern: /\bsetPrototypeOf\b/, label: 'setPrototypeOf' },
  { pattern: /\bObject\s*\.\s*defineProperty\b/, label: 'Object.defineProperty' },
  { pattern: /\bObject\s*\.\s*assign\b/, label: 'Object.assign' },
  { pattern: /\bReflect\b/, label: 'Reflect API' },

  // Bracket notation escapes (common bypass for string matching)
  { pattern: /\[\s*['"`](?:loc|coo|win|doc|nav|set|get|par|fra|top|sel)/, label: 'suspicious bracket access' },

  // Infinite loops
  { pattern: /\bwhile\s*\(\s*true\s*\)/, label: 'while(true) infinite loop' },
  { pattern: /\bfor\s*\(\s*;\s*;\s*\)/, label: 'for(;;) infinite loop' },
  { pattern: /\bwhile\s*\(\s*1\s*\)/, label: 'while(1) infinite loop' },

  // Timing abuse
  { pattern: /\bsetTimeout\s*\(/, label: 'setTimeout (use ctx.after instead)' },
  { pattern: /\bsetInterval\s*\(/, label: 'setInterval (use ctx.every instead)' },

  // String concatenation tricks to bypass other patterns
  { pattern: /\+\s*['"`](?:ation|kie|ment|dow|etch|ctor)/, label: 'suspicious string concatenation' },
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
  // SDK helpers
  'fireBullet', 'fireSpread', 'spawnBeamTick', 'spawnZone', 'findChainTargets',
  'computeLineHits', 'sortEnemies',
]);

export function createSafeContext(ctx) {
  // Freeze nested objects to prevent prototype chain traversal
  if (ctx.player) Object.freeze(ctx.player);

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
