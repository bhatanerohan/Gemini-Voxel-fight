# Refactoring Roadmap & Implementation Guide

**Priority:** Fixes ordered by impact and implementation effort

---

## Phase 1: Critical Fixes (Implement Immediately)

### 1.1 Fix Event Listener Accumulation [CRITICAL]

**File:** `src/gameState.js`
**Issue:** Listeners accumulate on every restart, causing exponential slowdown in long sessions
**Impact:** Game becomes unresponsive after 10+ restarts

**Current Code (lines 63-68):**
```javascript
restart() {
  Object.assign(this, structuredClone(initialState));
  // Clear all intervals/timeouts managed by game systems
  this.emit('restart', {});
},
```

**Fixed Code:**
```javascript
restart() {
  Object.assign(this, structuredClone(initialState));

  // CRITICAL: Clear all accumulated listeners to prevent exponential growth
  // This prevents listeners from accumulating on each restart
  Object.keys(listeners).forEach(event => {
    listeners[event] = [];
  });

  this.emit('restart', {});
},
```

**Verification:**
```javascript
// Add this test to verify fix
GameState.restart();
GameState.restart();
// Should fire each listener exactly once, not twice
```

---

### 1.2 Fix Missing Status Fields on Respawn

**File:** `src/main.js` (respawnEnemy function, lines 983-1012)
**Issue:** burnTick and burnAcc not reset on respawn, carry over from previous enemy
**Impact:** Burn damage timing incorrect on respawned enemies

**Current Code (lines 999-1008):**
```javascript
if (dead.status) {
  dead.status.freeze = 0;
  dead.status.stun = 0;
  dead.status.slowMult = 1;
  dead.status.slowTime = 0;
  dead.status.burnDps = 0;
  dead.status.burnTime = 0;
  dead.status.burnTick = 0.15;  // ← Missing this line!
  dead.status.burnAcc = 0;       // ← Missing this line!
}
```

**Actually, reviewing code again:** These ARE present in main.js. Check waves.js instead:

**File:** `src/waves.js` (lines 125-132)
**Current Code:**
```javascript
// Clear status effects
if (e.status) {
  e.status.freeze = 0;
  e.status.stun = 0;
  e.status.slowMult = 1;
  e.status.slowTime = 0;
  e.status.burnDps = 0;
  e.status.burnTime = 0;
  // Missing: burnTick, burnAcc
}
```

**Fixed Code:**
```javascript
// Clear status effects
if (e.status) {
  e.status.freeze = 0;
  e.status.stun = 0;
  e.status.slowMult = 1;
  e.status.slowTime = 0;
  e.status.burnDps = 0;
  e.status.burnTime = 0;
  e.status.burnTick = 0.15;   // ← ADD THIS
  e.status.burnAcc = 0;        // ← ADD THIS
}
```

---

### 1.3 Fix Hardcoded Ranged Enemy AI Values

**File:** `src/enemyAI.js`
**Issue:** preferredRange and fleeRange are defined in ENEMY_TYPES.ranged but not used
**Impact:** Cannot customize ranged enemy behavior via type config

**Current Code (lines 117-121):**
```javascript
function rangedAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);
  const preferredRange = 15;  // HARDCODED - should use typeConfig
  const fleeRange = 6;        // HARDCODED - should use typeConfig
```

**Fixed Code:**
```javascript
function rangedAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);
  const preferredRange = e.typeConfig?.preferredRange ?? 15;
  const fleeRange = e.typeConfig?.fleeRange ?? 6;
```

---

### 1.4 Add Safe Element Removal (DOM Cleanup)

**File:** `src/main.js` (showEnemyTaunt, lines 862-872)
**Issue:** setTimeout callback may try to remove element that's already gone
**Impact:** Rare errors in console if page reloads during taunt display

**Current Code:**
```javascript
function showEnemyTaunt(e) {
  if (!e.identity?.taunt) return;
  const el = document.createElement('div');
  el.className = 'enemy-taunt';
  el.textContent = `"${e.identity.taunt}"`;
  const screenPos = e.pos.clone().add(new THREE.Vector3(0, 2.5, 0)).project(camera);
  el.style.left = ((screenPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-screenPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);  // ← Not safe
}
```

**Fixed Code:**
```javascript
function showEnemyTaunt(e) {
  if (!e.identity?.taunt) return;
  const el = document.createElement('div');
  el.className = 'enemy-taunt';
  el.textContent = `"${e.identity.taunt}"`;
  const screenPos = e.pos.clone().add(new THREE.Vector3(0, 2.5, 0)).project(camera);
  el.style.left = ((screenPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-screenPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  document.body.appendChild(el);

  // Safe removal: check if element is still in DOM
  setTimeout(() => {
    if (el.parentElement) {
      el.remove();
    }
  }, 2500);
}
```

**Also apply to:** `src/sandbox.js` line 371 (enemy last words)

---

## Phase 2: Refactoring for Consistency (Plan Next Sprint)

### 2.1 Create Canonical Enemy Status Factory

**New File:** `src/utils/enemyStatus.js`
```javascript
/**
 * Creates a fresh status object for an enemy.
 * Used in initialization and respawn to ensure consistency.
 */
export function createEnemyStatus() {
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

/**
 * Resets status to default values without allocating new object.
 */
export function resetEnemyStatus(status) {
  status.freeze = 0;
  status.stun = 0;
  status.slowMult = 1;
  status.slowTime = 0;
  status.burnDps = 0;
  status.burnTime = 0;
  status.burnTick = 0.15;
  status.burnAcc = 0;
}
```

**Update:** `src/main.js` line 660
```javascript
// BEFORE
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

// AFTER
import { createEnemyStatus } from './utils/enemyStatus.js';

status: createEnemyStatus(),
```

**Update:** `src/main.js` line 880 (lazy initialization)
```javascript
// BEFORE
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

// AFTER
const s = e.status || (e.status = createEnemyStatus());
```

**Update:** `src/waves.js` line 125
```javascript
// BEFORE
if (e.status) {
  e.status.freeze = 0;
  e.status.stun = 0;
  e.status.slowMult = 1;
  e.status.slowTime = 0;
  e.status.burnDps = 0;
  e.status.burnTime = 0;
}

// AFTER
if (e.status) {
  resetEnemyStatus(e.status);
}
```

---

### 2.2 Consolidate Arena Geometry Constants

**New File:** `src/constants/arenaGeometry.js`
```javascript
/**
 * Arena boundaries and spawn zones.
 * Centralized to avoid duplication across main.js, waves.js, and hud.js
 */

export const ARENA_BOUNDS = {
  MIN: -48,
  MAX: 48,
};

export const SPAWN_BOUNDS = {
  MIN: -45,
  MAX: 45,
};

// Standard clamp function for arena positions
export function clampArenaBounds(pos, bounds = ARENA_BOUNDS) {
  pos.x = THREE.MathUtils.clamp(pos.x, bounds.MIN, bounds.MAX);
  pos.z = THREE.MathUtils.clamp(pos.z, bounds.MIN, bounds.MAX);
}
```

**Update:** `src/main.js` lines 848, 942
```javascript
// BEFORE (main.js:848)
player.pos.x = THREE.MathUtils.clamp(player.pos.x, -48, 48);
player.pos.z = THREE.MathUtils.clamp(player.pos.z, -48, 48);

// AFTER
import { clampArenaBounds } from './constants/arenaGeometry.js';
clampArenaBounds(player.pos);

// BEFORE (main.js:942)
e.pos.x = THREE.MathUtils.clamp(e.pos.x, -48, 48);
e.pos.z = THREE.MathUtils.clamp(e.pos.z, -48, 48);

// AFTER
clampArenaBounds(e.pos);
```

**Update:** `src/waves.js` line 121
```javascript
// BEFORE
e.pos.x = THREE.MathUtils.clamp(e.pos.x, -45, 45);
e.pos.z = THREE.MathUtils.clamp(e.pos.z, -45, 45);

// AFTER
import { clampArenaBounds, SPAWN_BOUNDS } from '../constants/arenaGeometry.js';
clampArenaBounds(e.pos, SPAWN_BOUNDS);
```

---

### 2.3 Restructure Enemy Modifiers

**Issue:** Currently mixing identity properties with modifier properties
```javascript
// Current: scattered properties
e.resistType      // From god modifier
e.identity.resistance  // From personality AI
e.speedBuff       // From god modifier
e.identity.personality  // From personality AI
```

**New Structure:** Separate namespaces
```javascript
// Better: clear separation
e.identity = {
  name, epithet, fullName,
  taunt, lastWords, grudge,
  personality, hasTaunted,
  // NOTE: resistance is part of identity, not a modifier
  resistance: null,
}

e.modifiers = {
  resistType: null,      // From god mutations
  speedBuff: 1.0,        // From god mutations
}

e.state = {
  dashState: { /* ... */ },
  strafeDir: 1,
  strafeTimer: 3,
}
```

**Update:** `src/arenaMutations.js` lines 205-216
```javascript
// BEFORE
switch (mod.type) {
  case 'resistance':
    e.resistType = mod.detail;
    break;
  case 'speed_buff':
    e.speedBuff = 1.5;
    break;
}

// AFTER
switch (mod.type) {
  case 'resistance':
    if (!e.modifiers) e.modifiers = {};
    e.modifiers.resistType = mod.detail;
    break;
  case 'speed_buff':
    if (!e.modifiers) e.modifiers = {};
    e.modifiers.speedBuff = 1.5;
    break;
}
```

**Update:** `src/sandbox.js` line 301
```javascript
// BEFORE
const resistance = e.identity?.resistance || e.resistType;

// AFTER
const resistance = e.identity?.resistance || e.modifiers?.resistType;
```

**Update:** `src/main.js` line 914
```javascript
// BEFORE
updateEnemyAI(e, player, enemies, dt, slowScale * (e.speedBuff || 1));

// AFTER
updateEnemyAI(e, player, enemies, dt, slowScale * (e.modifiers?.speedBuff || 1));
```

---

## Phase 3: Long-Term Architecture (Future Sprint)

### 3.1 Create Enemy Factory Class

**New File:** `src/core/EnemyFactory.js`
```javascript
import { createEnemyStatus } from '../utils/enemyStatus.js';
import { getTypeConfig } from '../enemyTypes.js';

export class EnemyFactory {
  /**
   * Creates a complete enemy object with canonical shape.
   * @param {THREE.Vector3} position
   * @param {string} typeName - 'grunt', 'charger', 'tank', 'ranged'
   * @param {object} mesh - Three.js mesh
   * @param {object} bodyMesh - Humanoid body for material changes
   * @param {object} nameEl - DOM element for name label
   * @param {object} barFill - DOM element for health bar
   */
  static create(position, typeName = 'grunt', mesh, bodyMesh, nameEl, barFill) {
    const typeConfig = getTypeConfig(typeName);

    return {
      // Immutable properties
      id: Math.random().toString(36).substr(2, 9),

      // Position & Physics
      pos: position.clone(),
      vel: new THREE.Vector3(),
      yaw: 0,

      // Health & Life
      alive: true,
      hp: typeConfig.hp,
      maxHp: typeConfig.hp,

      // Type & Config
      typeConfig,
      typeName,

      // AI & Behavior
      attackCooldown: 0,
      status: createEnemyStatus(),

      // Identity & Personality
      identity: null,

      // Modifiers (from arena god)
      modifiers: {
        resistType: null,
        speedBuff: 1.0,
        damageMultiplier: 1.0,
      },

      // Behavioral State
      state: {
        dashState: null,
        strafeDir: 1,
        strafeTimer: 3,
      },

      // UI References
      mesh,
      bodyMesh,
      nameEl,
      barFill,

      // Cached optimization
      _lastHealthPct: -1,
    };
  }

  static reset(enemy) {
    enemy.alive = true;
    enemy.hp = enemy.typeConfig.hp;
    enemy.maxHp = enemy.hp;
    enemy.attackCooldown = 0;
    enemy.vel.set(0, 0, 0);
    enemy.yaw = 0;

    resetEnemyStatus(enemy.status);

    enemy.modifiers.resistType = null;
    enemy.modifiers.speedBuff = 1.0;

    enemy.state.dashState = null;
    enemy.state.strafeDir = 1;
    enemy.state.strafeTimer = 3;

    enemy.identity = null;
    enemy._lastHealthPct = -1;

    return enemy;
  }
}
```

**Usage in main.js:**
```javascript
import { EnemyFactory } from './core/EnemyFactory.js';

// In init():
enemies.push(
  EnemyFactory.create(
    new THREE.Vector3(x, 0.6, z),
    'grunt',  // or pick type from wave composition
    group,
    bodyMesh,
    nameEl,
    barFill
  )
);

// In respawnEnemy():
export function respawnEnemy(x, z, hp = 100, typeConfig = null) {
  const dead = enemies.find(e => e.hp <= 0);
  if (!dead) return null;

  if (typeConfig) {
    dead.typeConfig = typeConfig;
    dead.typeName = typeConfig.name;
  }

  dead.pos.set(x, 0.6, z);
  dead.mesh.position.copy(dead.pos);
  dead.mesh.visible = true;

  return EnemyFactory.reset(dead);
}
```

---

### 3.2 Create UIElementManager for Safe Cleanup

**New File:** `src/core/UIElementManager.js`
```javascript
/**
 * Manages scheduled removal of DOM elements.
 * Prevents accumulation of pending removals and handles edge cases.
 */
export class UIElementManager {
  constructor() {
    this.pendingRemovals = [];
  }

  /**
   * Schedule an element for removal after delay.
   * Safe: checks if element is still in DOM before removing.
   */
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

  /**
   * Remove all pending callbacks and clear the list.
   * Call on game restart or when leaving scene.
   */
  clearAll() {
    this.pendingRemovals.forEach(t => clearTimeout(t));
    this.pendingRemovals = [];
  }

  /**
   * Get count of pending removals (for debugging).
   */
  getPendingCount() {
    return this.pendingRemovals.length;
  }
}
```

**Usage in main.js:**
```javascript
import { UIElementManager } from './core/UIElementManager.js';

const uiManager = new UIElementManager();

function showEnemyTaunt(e) {
  if (!e.identity?.taunt) return;
  const el = document.createElement('div');
  el.className = 'enemy-taunt';
  el.textContent = `"${e.identity.taunt}"`;
  const screenPos = e.pos.clone().add(new THREE.Vector3(0, 2.5, 0)).project(camera);
  el.style.left = ((screenPos.x * 0.5 + 0.5) * window.innerWidth) + 'px';
  el.style.top = ((-screenPos.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  document.body.appendChild(el);

  uiManager.scheduleRemoval(el, 2500);  // ← Safe cleanup
}

// On restart
GameState.on('restart', () => {
  uiManager.clearAll();
});
```

---

### 3.3 Add TypeScript Definitions (Optional but Recommended)

**New File:** `src/types/Enemy.d.ts`
```typescript
import * as THREE from 'three';

export interface EnemyStatus {
  freeze: number;
  stun: number;
  slowMult: number;
  slowTime: number;
  burnDps: number;
  burnTime: number;
  burnTick: number;
  burnAcc: number;
}

export interface EnemyIdentity {
  name: string;
  epithet: string;
  fullName: string;
  taunt: string | null;
  lastWords: string | null;
  grudge: string | null;
  resistance: string | null;
  personality: 'reckless' | 'cautious' | 'vengeful';
  hasTaunted: boolean;
}

export interface EnemyModifiers {
  resistType: string | null;
  speedBuff: number;
  damageMultiplier: number;
}

export interface EnemyBehaviorState {
  dashState: {
    cooldown: number;
    dashing: boolean;
    dashTime: number;
    dashDirX: number;
    dashDirZ: number;
  } | null;
  strafeDir: number;
  strafeTimer: number;
}

export interface Enemy {
  id: string;

  // Position & Physics
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;

  // Health & Life
  alive: boolean;
  hp: number;
  maxHp: number;

  // Type & Config
  typeConfig: any; // EnemyType from enemyTypes.js
  typeName: string;

  // AI & Behavior
  attackCooldown: number;
  status: EnemyStatus;

  // Identity & Personality
  identity: EnemyIdentity | null;

  // Modifiers
  modifiers: EnemyModifiers;

  // State
  state: EnemyBehaviorState;

  // UI References
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  nameEl: HTMLDivElement;
  barFill: HTMLDivElement;

  // Cache
  _lastHealthPct: number;
}
```

---

## Implementation Timeline

### Week 1: Critical Fixes
- [ ] Fix event listener accumulation (gameState.js)
- [ ] Fix missing status fields on respawn (waves.js)
- [ ] Fix hardcoded ranged AI values (enemyAI.js)
- [ ] Add safe DOM removal checks
- **Testing:** Play 20 waves, verify no slowdown on restart

### Week 2: Refactoring
- [ ] Extract createEnemyStatus() utility
- [ ] Create arenaGeometry constants
- [ ] Restructure enemy modifiers namespace
- **Testing:** Verify enemy stats still work correctly

### Week 3: Architecture
- [ ] Create EnemyFactory class
- [ ] Create UIElementManager
- [ ] Add TypeScript definitions
- **Testing:** Full game playthrough with new systems

### Week 4: Validation & Cleanup
- [ ] Remove old patterns from codebase
- [ ] Update documentation
- [ ] Performance profiling
- [ ] Code review

---

## Testing Checklist

```javascript
// Test 1: Event listener cleanup
function testEventListenerCleanup() {
  GameState.restart();  // Should clear listeners
  let count = 0;
  GameState.on('restart', () => count++);
  GameState.restart();
  console.assert(count === 1, 'Listener should fire exactly once after first registration');
}

// Test 2: Enemy status reset
function testEnemyStatusReset() {
  const enemy = /* created enemy */;
  enemy.status.burnTime = 5;
  resetEnemyStatus(enemy.status);
  console.assert(enemy.status.burnTime === 0, 'burnTime should be reset');
  console.assert(enemy.status.burnTick === 0.15, 'burnTick should be default');
}

// Test 3: Arena bounds clamping
function testArenaBounds() {
  const pos = new THREE.Vector3(100, 0, 100);
  clampArenaBounds(pos);
  console.assert(pos.x === 48 && pos.z === 48, 'Should clamp to bounds');
}

// Test 4: DOM cleanup
function testDOMCleanup() {
  const manager = new UIElementManager();
  const el = document.createElement('div');
  document.body.appendChild(el);
  manager.scheduleRemoval(el, 100);
  setTimeout(() => {
    console.assert(!document.body.contains(el), 'Element should be removed');
  }, 150);
}
```

