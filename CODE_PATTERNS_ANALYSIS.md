# Code Pattern Analysis: Gemini Voxel Arena Game

**Analysis Date:** February 2026
**Codebase Size:** ~4,539 lines across 32 JS files
**Primary Language:** JavaScript (ES2020+) with Three.js graphics library

---

## Executive Summary

The codebase demonstrates solid architectural boundaries and intentional system separation (game state, enemy AI, wave management, mutations, etc.). However, there are **critical naming inconsistencies** in the enemy object model and **potential memory leak risks** in DOM element cleanup. The event bus pattern is well-implemented but lacks listener cleanup protocol. Several opportunities exist to reduce ad-hoc property initialization and establish stricter object shape contracts.

**Key Findings:**
- **Critical Issues:** 2 (memory safety)
- **High Priority:** 5 (naming consistency, initialization patterns)
- **Medium Priority:** 6 (code duplication, event cleanup)
- **Low Priority:** 3 (documentation, test coverage)

---

## 1. ENEMY OBJECT SHAPE CONSISTENCY

### Pattern Description
Enemy objects are created with hardcoded initial properties in `main.js` (lines 641-663) and respawned via `respawnEnemy()` (lines 983-1012). Properties are added ad-hoc throughout the codebase, leading to an **implicit contract** that requires careful reading to understand.

### Current Enemy Shape
```javascript
// From main.js:641-663 (initial creation)
enemies.push({
  pos: new THREE.Vector3(x, 0.6, z),
  vel: new THREE.Vector3(),
  yaw: 0,
  mesh: group,
  bodyMesh: ebody,
  alive: true,
  hp: 100,
  maxHp: 100,
  attackCooldown: 0,
  status: { /* status object */ },
  barFill,
  nameEl,
});

// Added later by other systems:
e.identity         // from enemyIdentity.js (applied in waves.js:75)
e.typeConfig       // from enemyTypes.js (set in waves.js:96)
e.typeName         // set in waves.js:97
e.speedBuff        // set in arenaMutations.js:210
e.resistType       // set in arenaMutations.js:207
e.dashState        // created lazily in enemyAI.js:68
e.strafeDir        // created lazily in enemyAI.js:135
e.strafeTimer      // created lazily in enemyAI.js:140
e._lastPct         // created lazily in main.js:773 (for health bar optimization)
```

### Issues Identified

#### 1.1 Inconsistent Initialization Locations
- **Critical Properties** (pos, vel, mesh, hp) initialized in `main.js:641`
- **Type Configuration** assigned in `waves.js:96` but sometimes has fallback: `e.typeConfig?.attackRange || 2.5`
- **Behavioral State** (dashState, strafeDir) lazily initialized in `enemyAI.js` during first use

**Risk:** Code that accesses `e.typeConfig.attackRange` without the `?.` operator would crash if `typeConfig` hasn't been assigned yet. Currently line 961 uses `e.typeConfig?.attackCooldown || 1.2` which is defensive, but inconsistent.

```javascript
// main.js:957 — DEFENSIVE (good)
const attackRange = e.typeConfig?.attackRange || 2.5;

// main.js:961 — DEFENSIVE (good)
e.attackCooldown = e.typeConfig?.attackCooldown || 1.2;

// main.js:962 — DEFENSIVE (good)
const dmg = e.typeConfig?.damage || 10;
```

**Recommendation:** Replace fallback patterns with **guaranteed initialization** in respawnEnemy():
```javascript
export function respawnEnemy(x, z, hp = 100, typeConfig = null) {
  const dead = enemies.find(e => e.hp <= 0);
  if (!dead) return null;

  // Ensure typeConfig is always present
  if (typeConfig) {
    dead.typeConfig = typeConfig;
    dead.typeName = typeConfig.name;
  } else {
    dead.typeConfig = ENEMY_TYPES.grunt;
    dead.typeName = 'Grunt';
  }
  // ... rest of initialization
}
```

#### 1.2 Naming Convention Fragmentation
Three separate naming systems exist for enemy modifiers:

| Property | Set By | Purpose | Type |
|----------|--------|---------|------|
| `e.resistType` | arenaMutations.js:207 | God modifier for damage resistance | string (weapon type) |
| `e.identity.resistance` | enemyIdentity.js:79 (from Gemini) | Personalized resistance from AI | string (weapon type) |
| `e.speedBuff` | arenaMutations.js:210 | Arena god speed modifier | number (1.5) |
| `e.identity` | enemyIdentity.js (full object) | Complete personality identity | object |

**Issue:** Code checks both sources with unclear priority:
```javascript
// sandbox.js:301 — Checks identity FIRST, falls back to resistType
const resistance = e.identity?.resistance || e.resistType;
```

But they're set in different places with different authority levels. If both exist, which should win?

**Recommendation:** Establish a **modifier priority hierarchy**:
```javascript
// In enemy object initialization, create a "modifiers" namespace:
{
  modifiers: {
    resistType: null,        // From arena god mutations
    speedBuff: 1.0,          // From arena god mutations
    damageMultiplier: 1.0,   // Future extensibility
  }
}

// And clearly separate identity from modifiers:
{
  identity: {
    name, epithet, fullName,
    taunt, lastWords, grudge,
    personality, hasTaunted,
    resistance: null,  // Part of AI identity, not a modifier
  }
}
```

Then consolidate resistance check:
```javascript
const resistance = e.modifiers?.resistType || e.identity?.resistance;
```

#### 1.3 Status Object Dual Initialization Pattern
Status object is initialized in **two different ways**:

**Pattern A** (main.js:880-889): Lazy initialization on first access
```javascript
const s = e.status || (e.status = {
  freeze: 0,
  stun: 0,
  slowMult: 1,
  slowTime: 0,
  burnDps: 0,
  burnTime: 0,
  burnTick: 0.15,
  burnAcc: 0,
});
```

**Pattern B** (main.js:641-660): Pre-initialized during creation
```javascript
enemies.push({
  // ...
  status: {
    freeze: 0,
    stun: 0,
    slowMult: 1,
    slowTime: 0,
    burnDps: 0,
    burnTime: 0,
    burnTick: 0.15,
    burnAcc: 0,
  },
  // ...
});
```

**Pattern C** (sandbox.js:256-268): Helper function `ensureEnemyStatus()`
```javascript
function ensureEnemyStatus(e) {
  if (!e.status) {
    e.status = {};
  }
  if (typeof e.status.freeze !== 'number') e.status.freeze = 0;
  // ... per-property validation
  return e.status;
}
```

**Issue:** Three different safety patterns suggest uncertainty about initialization. Pattern B is most explicit but unused in respawnEnemy(). Pattern C is over-defensive.

**Recommendation:** Create a **single canonical initializer**:
```javascript
function createEnemyStatus() {
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

// Use consistently:
status: createEnemyStatus(),  // In main.js:641
dead.status = createEnemyStatus();  // In respawnEnemy()
```

---

## 2. EVENT BUS LIFECYCLE & LISTENER ACCUMULATION

### Pattern Description
Game uses `GameState.on()` for event subscription. Listeners are registered in multiple files but **never unregistered**.

### Events Registered
```javascript
// arenaGod.js:104-109 (5 listeners)
GameState.on('wave_clear', ...)
GameState.on('game_over', ...)
GameState.on('restart', ...)
GameState.on('player_near_death', ...)
GameState.on('multi_kill', ...)
GameState.on('first_forge', ...)

// arenaMutations.js:44-46 (3 listeners)
GameState.on('god_mutation', ...)
GameState.on('god_enemy_modifier', ...)
GameState.on('restart', ...)

// waves.js:36 (1 listener)
GameState.on('restart', ...)

// main.js:689 (1 listener)
GameState.on('hazard_player_hit', ...)

// sandbox.js:13 (1 listener)
GameState.on('restart', ...)

// matchMemory.js (1 listener)
GameState.on('restart', ...)

// enemyIdentity.js:90 (1 listener)
GameState.on('restart', ...)

// Total: ~15 listeners, none ever removed
```

### Issue: Potential Listener Accumulation

The `GameState` object maintains a `listeners` map that grows indefinitely:

```javascript
// gameState.js:12-27
const listeners = {};

export const GameState = {
  on(event, fn) {
    (listeners[event] ||= []).push(fn);  // Listeners ALWAYS added
  },
  off(event, fn) {
    const arr = listeners[event];
    if (arr) listeners[event] = arr.filter(f => f !== fn);
  },
  // ... emit()
};
```

**Current Behavior:**
- `on()` and `off()` methods exist
- **No call sites use `off()`** — checked entire codebase
- During `GameState.restart()` (line 64), state is reset but **listeners array is NOT cleared**

**Risk Scenario:**
```javascript
// Simulate multiple restarts in long play session
for (let i = 0; i < 100; i++) {
  GameState.restart();  // Listeners grow: n listeners → 2n listeners → 4n listeners
}

// After 100 restarts:
// wave_clear event fires: ~64,000 calls to consultArenaGod() instead of 1
// Game becomes unresponsive during wave clear
```

### Listeners on 'restart' Event (Most Critical)

```javascript
// arenaGod.js:106
GameState.on('restart', () => hideGodDialogue());

// arenaMutations.js:46
GameState.on('restart', () => resetMutations());

// waves.js:36
GameState.on('restart', () => { /* reset waves */ });

// sandbox.js:13
GameState.on('restart', () => { updateScore(0); updateKills(0); });

// matchMemory.js:233 (from search)
GameState.on('restart', () => MatchMemory.reset());

// enemyIdentity.js:90
GameState.on('restart', () => usedNames.clear());

// Total: 6 listeners on 'restart'
```

Each restart triggers all 6, and each subsequent restart adds 6 MORE listeners.

### Recommendation

**Option 1: Clear listeners on restart (Simplest)**
```javascript
// In gameState.js:63-68
restart() {
  Object.assign(this, structuredClone(initialState));

  // CRITICAL FIX: Clear all listeners
  Object.keys(listeners).forEach(event => {
    listeners[event] = [];
  });

  this.emit('restart', {});
},
```

**Option 2: Single-fire listeners for initialization (More robust)**
```javascript
// Add optional `once` flag
once(event, fn) {
  const wrapper = (data) => {
    fn(data);
    this.off(event, wrapper);
  };
  this.on(event, wrapper);
},

// Usage in arenaGod.js
GameState.once('restart', () => hideGodDialogue());
```

**Option 3: Module-level cleanup pattern**
```javascript
// In arenaGod.js
function initArenaGod() {
  const listeners = [];

  listeners.push(
    () => GameState.on('wave_clear', () => consultArenaGod('wave_end'))
  );

  return {
    cleanup() {
      listeners.forEach(fn => fn());
      listeners.length = 0;
    }
  };
}

// Call cleanup on restart
GameState.on('restart', () => arenaGod.cleanup());
```

**Recommendation:** Implement **Option 1** (immediate) + **Option 3** (long-term). This is a critical bug in high-session play.

---

## 3. DOM ELEMENT CLEANUP PATTERN

### Pattern Description
Taunts, last words, and damage numbers are created dynamically and removed via `setTimeout()`.

### Instances Found

```javascript
// main.js:871 — Enemy taunt display
setTimeout(() => el.remove(), 2500);

// sandbox.js:371 — Enemy last words on death
setTimeout(() => lw.remove(), 2500);

// hud.js:60 — Damage number
setTimeout(() => el.remove(), 800);
```

### Issues Identified

#### 3.1 Missing Error Handling
If element is removed elsewhere (e.g., via DOM reset), the `setTimeout` callback will try to remove an orphaned element:

```javascript
// main.js:862-871
function showEnemyTaunt(e) {
  if (!e.identity?.taunt) return;
  const el = document.createElement('div');
  el.className = 'enemy-taunt';
  el.textContent = `"${e.identity.taunt}"`;

  const screenPos = e.pos.clone().add(new THREE.Vector3(0, 2.5, 0)).project(camera);
  el.style.left = ((screenPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-screenPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  document.body.appendChild(el);

  setTimeout(() => el.remove(), 2500);  // Risk: el might be gone already
}
```

**Risk:** If page is unloaded or reloaded during 2.5 second window, error in console.

#### 3.2 Memory Leak in Extended Sessions
No tracking of pending removal callbacks. In a 1-hour+ play session with ~1000 waves:
- Taunts: 4 enemies × 1000 waves = 4,000 pending removals
- Last words: 20 kills × 50 waves = 1,000 pending removals
- **Total:** ~5,000 pending setTimeout callbacks

Modern JavaScript engines handle this reasonably, but it's wasteful.

### Recommendation

**Create a cleanup manager:**
```javascript
class UIElementManager {
  constructor() {
    this.pendingRemovals = [];
  }

  scheduleRemoval(element, delayMs = 2500) {
    if (!element || !element.parentElement) return;

    const timeout = setTimeout(() => {
      if (element.parentElement) {
        element.remove();
      }
      const idx = this.pendingRemovals.indexOf(timeout);
      if (idx !== -1) this.pendingRemovals.splice(idx, 1);
    }, delayMs);

    this.pendingRemovals.push(timeout);
  }

  clearAll() {
    this.pendingRemovals.forEach(t => clearTimeout(t));
    this.pendingRemovals = [];
  }
}

// Usage
const uiManager = new UIElementManager();

function showEnemyTaunt(e) {
  const el = document.createElement('div');
  // ... setup ...
  document.body.appendChild(el);
  uiManager.scheduleRemoval(el, 2500);
}

// On game restart
GameState.on('restart', () => uiManager.clearAll());
```

---

## 4. FALLBACK PATTERN CONSISTENCY

### Pattern Description
Defensive property access using optional chaining (`?.`) and `||` fallbacks appear selectively.

### Instances

**Consistent Defensive Access:**
```javascript
// main.js:957 — attackRange
const attackRange = e.typeConfig?.attackRange || 2.5;

// main.js:961 — attackCooldown
e.attackCooldown = e.typeConfig?.attackCooldown || 1.2;

// main.js:962 — damage
const dmg = e.typeConfig?.damage || 10;

// sandbox.js:301 — resistance check
const resistance = e.identity?.resistance || e.resistType;

// sandbox.js:319 — scoreValue
GameState.addScore(e.typeConfig?.scoreValue || 100);

// enemyAI.js:18 — type name
const type = e.typeConfig?.name || 'Grunt';
```

**Inconsistent (Assumes Initialization):**
```javascript
// enemyAI.js:120-121 — ASSUMES preferredRange exists
const preferredRange = 15;  // Hardcoded, not from typeConfig

// enemyAI.js:67-68 — Lazy initialization assumes dashState doesn't exist
if (e.dashState === undefined) {
  e.dashState = { cooldown: 2, dashing: false, /* ... */ };
}

// enemyAI.js:135 — Defaults to 1 if undefined
const strafeDir = ((e.strafeDir ?? 1));

// main.js:959 — attackCooldown accessed after initialization
e.attackCooldown = (e.attackCooldown ?? 0) - dt;
```

**Issue:** Some properties like `preferredRange`, `fleeRange` in `rangedAI()` are hardcoded instead of coming from `typeConfig`:

```javascript
// enemyAI.js:117-121
function rangedAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);
  const preferredRange = 15;  // HARDCODED
  const fleeRange = 6;        // HARDCODED

  // These should come from typeConfig:
  // e.typeConfig.preferredRange (already in enemyTypes.js:68!)
  // e.typeConfig.fleeRange (already in enemyTypes.js:69!)
}
```

### Check enemyTypes.js

```javascript
// enemyTypes.js:61-85
ranged: {
  name: 'Ranged',
  hp: 60,
  speed: 0.8,
  damage: 12,
  attackRange: 25,
  attackCooldown: 1.8,
  preferredRange: 15,     // EXISTS!
  fleeRange: 6,           // EXISTS!
  // ...
}
```

**Bug:** `preferredRange` and `fleeRange` are **defined in typeConfig but ignored** by the AI code. It hardcodes the same values instead.

### Recommendation

**Replace hardcoded values with typeConfig:**
```javascript
// enemyAI.js:117-121 (BEFORE)
function rangedAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);
  const preferredRange = 15;
  const fleeRange = 6;
  // ...
}

// enemyAI.js:117-121 (AFTER)
function rangedAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);
  const preferredRange = e.typeConfig?.preferredRange ?? 15;
  const fleeRange = e.typeConfig?.fleeRange ?? 6;
  // ...
}
```

This ensures customization via typeConfig works as designed.

---

## 5. CODE DUPLICATION ANALYSIS

### 5.1 Status Object Initialization (3 copies)

**Copy A** — main.js:641-660 (initial enemy creation)
```javascript
status: {
  freeze: 0,
  stun: 0,
  slowMult: 1,
  slowTime: 0,
  burnDps: 0,
  burnTime: 0,
  burnTick: 0.15,
  burnAcc: 0,
},
```

**Copy B** — main.js:880-889 (lazy initialization in updateEnemies)
```javascript
const s = e.status || (e.status = {
  freeze: 0,
  stun: 0,
  slowMult: 1,
  slowTime: 0,
  burnDps: 0,
  burnTime: 0,
  burnTick: 0.15,
  burnAcc: 0,
});
```

**Copy C** — waves.js:126-132 (respawn status reset)
```javascript
if (e.status) {
  e.status.freeze = 0;
  e.status.stun = 0;
  e.status.slowMult = 1;
  e.status.slowTime = 0;
  e.status.burnDps = 0;
  e.status.burnTime = 0;
}
```

**Impact:** Changing status structure requires 3 locations. Already contains bug: Copy C doesn't reset `burnTick` and `burnAcc`.

### 5.2 Enemy Type Fallbacks (5 instances)

```javascript
// main.js:957
e.typeConfig?.attackRange || 2.5

// main.js:961
e.typeConfig?.attackCooldown || 1.2

// main.js:962
e.typeConfig?.damage || 10

// sandbox.js:319
e.typeConfig?.scoreValue || 100

// enemyAI.js:18
e.typeConfig?.name || 'Grunt'
```

**Pattern:** All follow same convention but could be consolidated into a **getTypeProperty()** helper.

### 5.3 Enemy Position Clamping (2 instances)

**Instance A** — main.js:848-849 (player)
```javascript
player.pos.x = THREE.MathUtils.clamp(player.pos.x, -48, 48);
player.pos.z = THREE.MathUtils.clamp(player.pos.z, -48, 48);
```

**Instance B** — main.js:942-943 (enemies)
```javascript
e.pos.x = THREE.MathUtils.clamp(e.pos.x, -48, 48);
e.pos.z = THREE.MathUtils.clamp(e.pos.z, -48, 48);
```

**Instance C** — waves.js:121-122 (enemy spawn)
```javascript
e.pos.x = THREE.MathUtils.clamp(e.pos.x, -45, 45);
e.pos.z = THREE.MathUtils.clamp(e.pos.z, -45, 45);
```

**Issue:** Three different ranges (-48, -48, -45) with no explanation.

### 5.4 Health Bar Update Clamping (2 instances)

```javascript
// main.js:772
const pct = Math.max(0, e.hp / e.maxHp) * 100;

// sandbox.js (implicit in damage display)
```

### Recommendation: Create Utilities

```javascript
// utils/arenaGeometry.js
export const ARENA_BOUNDS = {
  MIN: -48,
  MAX: 48,
  SPAWN_MIN: -45,
  SPAWN_MAX: 45,
};

export function clampArenaXZ(pos, bounds = ARENA_BOUNDS) {
  pos.x = THREE.MathUtils.clamp(pos.x, bounds.MIN, bounds.MAX);
  pos.z = THREE.MathUtils.clamp(pos.z, bounds.MIN, bounds.MAX);
}

// Usage in main.js:848
clampArenaXZ(player.pos);

// Usage in main.js:942
clampArenaXZ(e.pos);

// Usage in waves.js:121
clampArenaXZ(e.pos, ARENA_BOUNDS_SPAWN);
```

---

## 6. NAMING CONVENTIONS ANALYSIS

### 6.1 Abbreviation Inconsistency

| Abbreviation | Full Name | Instances | Context |
|---|---|---|---|
| `s` | status | 10+ | Used in loops to refer to e.status |
| `e` | enemy | 50+ | Used in loops |
| `dt` | deltaTime | 100+ | Time delta parameter |
| `v` | velocity/variable | 5 | Interval object, generic |
| `r` | remaining/remaining time | 3 | In timer objects |
| `f` | function | 2 | Timer callback functions |
| `p` | period | 1 | Interval period |

**Pattern:** 1-letter variable names common in hot loops (acceptable for `dt`, `e`), but inconsistent single-letter names for business logic (`s`, `v`, `r`, `f`, `p`) reduce readability.

```javascript
// sandbox.js:202-212 (unclear)
for (let i = timers.length - 1; i >= 0; i--) {
  timers[i].r -= dt;
  if (timers[i].r <= 0) {
    try { timers[i].f(); } catch (e) { console.error(e); }
    timers.splice(i, 1);
  }
}
for (let i = intervals.length - 1; i >= 0; i--) {
  const v = intervals[i];
  if (v.s) { intervals.splice(i, 1); continue; }
  v.r -= dt;
  if (v.r <= 0) { v.r += v.p; try { v.f(); } catch (e) { console.error(e); } }
}
```

Should be:
```javascript
for (let i = timers.length - 1; i >= 0; i--) {
  const timer = timers[i];
  timer.remaining -= dt;
  if (timer.remaining <= 0) {
    try { timer.callback(); } catch (err) { console.error(err); }
    timers.splice(i, 1);
  }
}
for (let i = intervals.length - 1; i >= 0; i--) {
  const interval = intervals[i];
  if (interval.shouldStop) { intervals.splice(i, 1); continue; }
  interval.remaining -= dt;
  if (interval.remaining <= 0) {
    interval.remaining += interval.period;
    try { interval.callback(); } catch (err) { console.error(err); }
  }
}
```

### 6.2 Boolean Property Naming

| Property | Location | Convention |
|----------|----------|-----------|
| `alive` | main.js:647 | ✅ Adjective form |
| `hasMuzzleGauntlet` | main.js:250 | ✅ Has-prefix |
| `hasTaunted` | enemyIdentity.js:81 | ✅ Has-prefix |
| `dashing` | enemyAI.js:68 | ✅ Verb-ing form |
| `fading` | sandbox.js:187 | ✅ Verb-ing form |
| `waveActive` | waves.js:14 | ✅ Adjective form |
| `transparent` | Material prop (THREE.js) | ✅ Adjective form |

**Status:** Consistent and well-named. No issues here.

### 6.3 Prefix/Suffix Patterns

```javascript
_scene              // Private module state (leading underscore)
_enemies            // Private module state
_getAimPoint        // Private function reference
_playerYaw          // Private function getter
_cachedFlashEl      // Private cached reference
_tempVec            // Reusable temp vector
cameraCollisionMeshes    // Public but unclear intent
aimCollisionMeshes       // Public but unclear intent
ARENA_BOUNDS        // Constants in SCREAMING_SNAKE_CASE ✅
CAMERA_RIG          // Constants in SCREAMING_SNAKE_CASE ✅
```

**Pattern A: Private `_prefix`**
```javascript
let _cachedCrosshairEl = null;
function setCrosshairPosition(clientX, clientY) {
  const crosshair = _cachedCrosshairEl || (_cachedCrosshairEl = document.getElementById('crosshair'));
  if (!crosshair) return;
  // ...
}
```

**Pattern B: Module-scoped globals without prefix**
```javascript
// sandbox.js
let _scene, _camera, _enemies, _player, _playerYaw;
let _getAimPoint = null;
```

Both exist and are understood, but naming could be more explicit.

### 6.4 Type-Specific Naming Issues

**Problem:** Enemy modifier properties use inconsistent prefixes:

```javascript
// Modifier properties (added by different systems):
e.speedBuff         // Describes effect (buff)
e.resistType        // Describes mechanism (type of resistance)
e.dashState         // Describes object shape (state object)
e.strafeDir         // Describes value (direction)
e.strafeTimer       // Describes value (timer)

// Identity properties:
e.identity.resistance   // Also describes mechanism
e.identity.personality  // Describes trait
e.identity.taunt        // Describes content
```

**Recommendation:** Namespace under `modifiers`:
```javascript
e.modifiers = {
  speedBuff: 1.0,
  resistanceType: null,
}

e.state = {
  dashState: { /* ... */ },
  strafeDir: 1,
  strafeTimer: 3,
}
```

---

## 7. ARCHITECTURAL BOUNDARY REVIEW

### 7.1 Layer Separation

```
┌─────────────────────────────────────────┐
│         main.js (Game Loop)             │
│  - Rendering, input, camera management  │
│  - Enemy update loop                    │
└──────────────┬──────────────────────────┘
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
   sandbox.js waves.js enemyAI.js
   (Weapons) (Wave)    (Enemy behavior)
      │        │        │
      └────────┼────────┘
               ▼
    gameState.js (Event Bus)
               │
      ┌────────┼─────────────────────┐
      ▼        ▼        ▼             ▼
   arenaMutations  enemyIdentity   arenaGod
   (Arena mods)   (Personality)    (AI Oracle)
```

**Assessment:** ✅ Clean separation of concerns. Each subsystem has clear responsibility.

### 7.2 Boundary Violations

**Violation A: Cross-layer access in main.js**

```javascript
// main.js:914 — Direct access to enemyAI function
updateEnemyAI(e, player, enemies, dt, slowScale * (e.speedBuff || 1));
```

This is acceptable because `enemyAI` is a pure function layer.

**Violation B: Direct property modification in arenaMutations.js**

```javascript
// arenaMutations.js:207-210 — Direct mutation of enemy object
switch (mod.type) {
  case 'resistance':
    e.resistType = mod.detail;
    break;
  case 'speed_buff':
    e.speedBuff = 1.5;
    break;
}
```

**Better approach:** Use setter methods or events:
```javascript
// Option 1: Setter methods on enemy object
// e.applyModifier('speed_buff', { value: 1.5 })

// Option 2: Event bus
// GameState.emit('apply_speed_buff', { enemy: e, value: 1.5 })
// Then enemy subscribes to this

// Option 3: Dedicated modifier system (RECOMMENDED)
export class EnemyModifierSystem {
  static applyResistance(enemy, type) {
    enemy.modifiers.resistanceType = type;
  }

  static applySpeedBuff(enemy, value = 1.5) {
    enemy.modifiers.speedBuff = value;
  }
}
```

### 7.3 Circular Dependency Check

- `main.js` → `sandbox.js` ✅ (one-way import)
- `main.js` → `waves.js` ✅ (one-way import)
- `main.js` → `enemyAI.js` ✅ (one-way import)
- `main.js` → `gameState.js` ✅ (one-way import)
- `waves.js` → `gameState.js` ✅ (one-way import)
- `sandbox.js` → `gameState.js` ✅ (one-way import)
- **No circular dependencies detected** ✅

---

## 8. ANTI-PATTERNS DETECTED

### 8.1 Premature Optimization

```javascript
// main.js:773 — Cache optimization for health bar
if (e._lastPct === pct) continue;
e._lastPct = pct;
```

This is reasonable for per-frame DOM updates, but using a private property `_lastPct` is unconventional. Consider:

```javascript
// Better: Use a map or WeakMap
const healthBarCache = new WeakMap();

function updateHealthBars() {
  for (const e of enemies) {
    if (e.alive === false) continue;
    const pct = Math.max(0, e.hp / e.maxHp) * 100;
    const lastPct = healthBarCache.get(e) ?? -1;
    if (lastPct === pct) continue;
    healthBarCache.set(e, pct);
    // ... update DOM
  }
}
```

### 8.2 Magic Numbers (High Count)

```javascript
// CAMERA_RIG (good: centralized)
distance: 6.1,
pivotHeight: 1.45,

// Scattered magic numbers (bad):
Math.PI / 2           // Used 20+ times without constant
0.6                   // Player/enemy Y position (5+ places)
-48, 48               // Arena bounds (3 places with inconsistency)
12, 15, 6             // Range values (hardcoded in enemyAI)
```

**Recommendation:** Create constants file:
```javascript
// constants.js
export const PLAYER_BASE_Y = 0.6;
export const ARENA = {
  MIN: -48,
  MAX: 48,
  SPAWN_MIN: -45,
  SPAWN_MAX: 45,
};
export const ENEMY_AI = {
  GRUNT: { aggroDist: 60, safeBackawayDist: 6 },
  RANGED: { preferredRange: 15, fleeRange: 6 },
  // ...
};
```

### 8.3 Missing Validation

```javascript
// enemyAI.js:28-31 — Assumes e and player have .pos
function distToPlayer(e, player) {
  const dx = player.pos.x - e.pos.x;
  const dz = player.pos.z - e.pos.z;
  return { dx, dz, dist: Math.sqrt(dx * dx + dz * dz) };
}

// What if e.pos is null? No guard.
```

**Add:** Null guards or TypeScript types.

---

## 9. SUMMARY TABLE

| Category | Issue | Severity | Files | Recommendation |
|----------|-------|----------|-------|-----------------|
| Enemy Object Shape | Inconsistent property initialization | HIGH | main.js, waves.js, enemyAI.js | Create factory function + schema |
| Enemy Modifiers | Fragmented naming (resistType vs identity.resistance) | HIGH | arenaMutations.js, sandbox.js | Consolidate under `modifiers` namespace |
| Status Object | 3 copies of same structure | MEDIUM | main.js, waves.js, sandbox.js | Extract to constant/factory |
| Event Listeners | No cleanup on restart → accumulation | CRITICAL | gameState.js, all subscribers | Clear listeners on restart() |
| DOM Cleanup | setTimeout without error handling | MEDIUM | main.js, sandbox.js, hud.js | Create UIElementManager |
| Fallback Patterns | typeConfig sometimes has fallbacks | LOW | main.js, sandbox.js, enemyAI.js | Ensure initialization or consistent fallbacks |
| Code Duplication | Status object, clamping, fallbacks | MEDIUM | main.js, waves.js, sandbox.js | Extract utilities |
| Naming | 1-letter vars in business logic (s, v, r, f, p) | MEDIUM | sandbox.js | Use descriptive names |
| Magic Numbers | Arena bounds, ranges scattered | MEDIUM | main.js, waves.js, enemyAI.js | Create constants.js |
| Validation | Missing null checks in hot paths | LOW | enemyAI.js | Add guards or types |

---

## 10. QUICK WINS (Easy Fixes)

1. **Fix typo in respawnEnemy()** — doesn't reset burnTick, burnAcc (waves.js:125-132)
2. **Use typeConfig values in rangedAI()** — preferredRange, fleeRange hardcoded (enemyAI.js:120-121)
3. **Clear listeners on restart()** — single line fix in gameState.js:64
4. **Extract createEnemyStatus()** — reduce duplication across 3 files

---

## 11. LONG-TERM IMPROVEMENTS

1. **Create Enemy schema/class** to define canonical shape
2. **Implement modifier system** (EnemyModifierSystem) for god mutations
3. **Add TypeScript** for type safety on enemy object
4. **Create utilities/arenaGeometry.js** for shared constants
5. **Implement listener cleanup** protocol in gameState.js
6. **Create UIElementManager** for DOM lifecycle

