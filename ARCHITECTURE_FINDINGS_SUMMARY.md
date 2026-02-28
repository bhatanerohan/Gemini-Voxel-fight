# Architecture Review - Key Findings & Code References

## Quick Reference: File Locations & Issues

### 1. Dual Resistance Sources (CRITICAL)

**Files Involved**:
- `/src/sandbox.js` line 301 (PRIMARY ISSUE)
- `/src/arenaMutations.js` line 207
- `/src/enemyIdentity.js` (implied)

**Problem Code**:
```javascript
// sandbox.js:296-304
function damageEnemy(e, amt, flashOpts = {}) {
  if (!Number.isFinite(amt) || amt <= 0) return;
  if (e.alive === false) return;

  // ISSUE: Dual sources of truth
  const weaponLower = getActiveWeaponName().toLowerCase();
  const resistance = e.identity?.resistance || e.resistType;  // ← LINE 301
  if (resistance && weaponLower.includes(resistance)) {
    amt *= 0.5;
  }
```

**Where it's set**:
```javascript
// arenaMutations.js:201-218 (function applyEnemyModifier)
function applyEnemyModifier(mod) {
  if (!_enemies) return;
  const alive = _enemies.filter(e => e.alive);
  for (const e of alive) {
    switch (mod.type) {
      case 'resistance':
        e.resistType = mod.detail;  // ← ARENA MUTATION SETS THIS
        break;
      case 'speed_buff':
        e.speedBuff = 1.5;
        break;
      // ...
    }
  }
}
```

**Undefined behavior**: If `identity.resistance = 'fire'` and arena mutation sets `resistType = 'ice'`, the JavaScript `||` operator will use `identity.resistance` because it's truthy and comes first.

---

### 2. God Object: Enemy Properties Scattered (CRITICAL)

**File**: `/src/main.js`, `/src/waves.js`, `/src/sandbox.js`, `/src/enemyAI.js`

**Total properties on single `e` object** (~35+):

| Category | Properties | File |
|----------|-----------|------|
| **Core** | pos, vel, mesh, alive, hp, maxHp, yaw, attackCooldown | main.js |
| **Type Config** | typeConfig, typeName | waves.js:93-97 |
| **Status Effects** | status.freeze, status.stun, status.slowMult, status.slowTime, status.burnDps, status.burnTime, status.burnAcc, status.burnTick | sandbox.js:256-268, main.js:880-889 |
| **Identity** | identity (name, taunt, lastWords, resistance, hasTaunted), nameEl | waves.js:77 |
| **AI Behavior** | dashState (charger), strafeDir, strafeTimer (ranged) | enemyAI.js:67-140 |
| **Arena Modifiers** | resistType, speedBuff | arenaMutations.js:207-210 |
| **UI** | bodyMesh, barFill, _lastPct | sandbox.js (implied), main.js:769 |

**Example from enemyAI.js** (type-specific state on generic object):
```javascript
// enemyAI.js:62-71 (Charger AI)
function chargerAI(e, player, allEnemies, dt, slowScale) {
  const { dx, dz, dist } = distToPlayer(e, player);

  // Initialize dash state — but this is ONLY used by chargers!
  if (e.dashState === undefined) {
    e.dashState = { cooldown: 2, dashing: false, dashTime: 0, dashDirX: 0, dashDirZ: 0 };
  }
```

**Example from enemyAI.js** (ranged strafe state):
```javascript
// enemyAI.js:132-144 (Ranged AI)
// Change strafe direction periodically
e.strafeTimer = (e.strafeTimer ?? 3) - dt;
if (e.strafeTimer <= 0) {
  e.strafeDir = -(e.strafeDir ?? 1);  // ← Type-specific, on generic object
  e.strafeTimer = 2 + Math.random() * 2;
}
```

---

### 3. Fragmented Damage Pipelines (MAJOR)

**Files**:
- `/src/main.js` lines 956-976 (melee damage)
- `/src/sandbox.js` lines 296-325 (weapon damage)

**Melee Damage** (main.js:956-976):
```javascript
// Melee attack
const attackRange = e.typeConfig?.attackRange || 2.5;
if (!frozen && !stunned && dist < attackRange) {
  e.attackCooldown = (e.attackCooldown ?? 0) - dt;
  if (e.attackCooldown <= 0) {
    e.attackCooldown = e.typeConfig?.attackCooldown || 1.2;
    const dmg = e.typeConfig?.damage || 10;
    if (player.invulnTimer <= 0 && player.hp > 0) {
      player.hp -= dmg;  // ← DIRECT MUTATION, NO RESISTANCE CHECK
      MatchMemory.recordPlayerHit(dmg, player.hp);
      playPlayerHit();
      player.invulnTimer = 0.3;
      triggerFlash(0.2);
      setShake(0.4, 0.2);
      updatePlayerHealthBar();
      if (player.hp <= 0) {
        playerDeath();
      }
    }
  }
}
```

**Weapon Damage** (sandbox.js:296-325):
```javascript
function damageEnemy(e, amt, flashOpts = {}) {
  if (!Number.isFinite(amt) || amt <= 0) return;
  if (e.alive === false) return;

  // RESISTANCE APPLIED
  const weaponLower = getActiveWeaponName().toLowerCase();
  const resistance = e.identity?.resistance || e.resistType;
  if (resistance && weaponLower.includes(resistance)) {
    amt *= 0.5;
  }

  e.hp -= amt;
  playHit();
  flashEnemyHit(e, flashOpts);

  // Floating damage number
  if (_camera) {
    const screenPos = e.pos.clone().project(_camera);
    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;
    showDamageNumber(x, y, amt, '#ffcc00');
  }

  if (e.hp <= 0) {
    playEnemyDeath();
    GameState.addScore(e.typeConfig?.scoreValue || 100);
    updateKills(GameState.kills);
    updateScore(GameState.score);
    deathEffect(e.pos.clone());
    respawn(e);
  }
}
```

**Differences**:
| Aspect | Melee | Weapon |
|--------|-------|--------|
| Resistance check | ✗ None | ✓ Yes (halves damage) |
| Damage number | ✗ None | ✓ Floating text |
| Death effect | ✗ Triggers in AI | ✓ In damageEnemy() |
| Score tracking | ? MatchMemory | ? GameState.addScore() |

**Problem**: If you add crit multipliers, weakness matchups, or buff modifiers, you must edit BOTH locations and keep them in sync.

---

### 4. Mixed Concerns in updateEnemies (COUPLING)

**File**: `/src/main.js` lines 877-978

Single function handles:
1. **Status initialization** (line 880-889)
2. **AI dispatch** (line 914)
3. **Physics** (gravity, friction, position, lines 918-944)
4. **Attack logic** (lines 956-976)
5. **Animation** (line 948)

**Code structure**:
```javascript
function updateEnemies(dt) {  // ← 100+ line monolithic function
  for (const e of enemies) {
    if (e.alive === false) continue;

    // 1. STATUS INIT
    const s = e.status || (e.status = { /* ... */ });

    // 2. AI DISPATCH
    if (!stunned) {
      updateEnemyAI(e, player, enemies, dt, slowScale * (e.speedBuff || 1));
    }

    // 3. PHYSICS
    if (e.pos.y > 0.6) {
      e.vel.y -= 20 * dt;  // gravity
    } else {
      e.vel.x *= (1 - 3 * dt);
      e.vel.z *= (1 - 3 * dt);
    }
    e.pos.addScaledVector(e.vel, dt);

    // 4. ANIMATION
    animateHumanoid(e.mesh, dt, Math.hypot(e.vel.x, e.vel.z));

    // 5. ATTACK LOGIC
    const attackRange = e.typeConfig?.attackRange || 2.5;
    if (!frozen && !stunned && dist < attackRange) {
      e.attackCooldown = (e.attackCooldown ?? 0) - dt;
      if (e.attackCooldown <= 0) {
        // ... damage player
      }
    }
  }
}
```

**Problem**: Can't test physics in isolation, can't reuse AI system for other entities, single change touches multiple concerns.

---

### 5. Event Flow - Inconsistent Restart Pattern (MEDIUM)

**File**: `/src/gameState.js` lines 63-67 (emits), other files (subscribe)

**Consistent subscribers**:
```javascript
// waves.js:36-46
GameState.on('restart', () => {
  waveActive = false;
  restTimer = 0;
  for (const e of _enemies) {
    e.mesh.visible = false;
    e.alive = false;
  }
  setTimeout(() => startNextWave(), 500);
});

// sandbox.js:13-16
GameState.on('restart', () => {
  updateScore(0);
  updateKills(0);
});

// arenaMutations.js:46
GameState.on('restart', () => {
  resetMutations();
});
```

**Inconsistent - manual cleanup in main.js** (lines 809-827):
```javascript
function restartGame() {
  hideChronicle();
  GameState.restart();  // ← Emits restart event, but...
  MatchMemory.reset();
  player.hp = player.maxHp;
  player.pos.set(0, 0.6, 0);
  player.vel.set(0, 0, 0);
  player.invulnTimer = 0;
  updatePlayerHealthBar();
  // ... manual enemy reset
  for (const e of enemies) {
    e.hp = e.maxHp;
    e.pos.set((Math.random() - 0.5) * 60, 0.6, (Math.random() - 0.5) * 60);
    e.vel.set(0, 0, 0);
    e.mesh.visible = true;
    e.attackCooldown = 0;
  }
}
```

**Missing cleanups** in main.js:
- `slowMoTimer`, `slowMoScale` (line 74-75)
- `flashAlpha` (line 76)
- `keys` object (line 29)
- `mouseDown` (line 30)
- Player animation state
- Sandbox state: `entities[]`, `trails[]`, `cbs[]`, `timers[]`, `intervals[]`
- Enemy state: `dashState`, `strafeDir`, `status` not fully cleared

---

### 6. DOM Elements on Game Entity (COUPLING)

**Files**:
- `/src/waves.js` line 77 (sets `nameEl`)
- `/src/main.js` line 769-778 (reads `_lastPct` from entity)

**Problem Code**:
```javascript
// waves.js:76-78 (in spawnWaveEnemies)
const e = _enemies[i];
e.identity = null;
if (e.nameEl) e.nameEl.textContent = '';  // ← DOM element stored on game object
```

```javascript
// main.js:769-778 (in updateHealthBars)
function updateHealthBars() {
  for (const e of enemies) {
    if (e.alive === false) continue;
    const pct = Math.max(0, e.hp / e.maxHp) * 100;
    if (e._lastPct === pct) continue;  // ← Caching on entity
    e._lastPct = pct;
    e.barFill.style.width = pct + '%';  // ← DOM ref used here
    e.barFill.className = 'health-bar-fill ' + (pct > 60 ? 'healthy' : pct > 30 ? 'mid' : 'low');
  }
}
```

**Problem**: Game logic layer imports UI layer references. Makes testing hard, couples to DOM structure.

---

## DEPENDENCY GRAPH (Clean)

```
gameState.js (LEAF)
    ↑
    ├─ waves.js
    ├─ sandbox.js
    ├─ arenaMutations.js
    └─ main.js (ROOT)
        ├─ enemyAI.js (pure)
        └─ enemyTypes.js (pure)
```

**Status**: ✓ **No circular dependencies**. Clean layering.

---

## SOLID Principles Compliance

| Principle | Status | Example Violation |
|-----------|--------|-------------------|
| **S**ingle Responsibility | ✗ FAIL | Enemy: 35+ properties, 7 domains (physics, type, status, identity, UI, AI, modifiers) |
| **O**pen/Closed | ✗ FAIL | Adding status effect requires changes in multiple files (main.js, sandbox.js) |
| **L**iskov Substitution | ✓ PASS | Enemies are interchangeable |
| **I**nterface Segregation | ✗ FAIL | All systems access same `e` god object; no focused contracts |
| **D**ependency Inversion | ⚠ PARTIAL | arenaMutations → GameState (good), but main.js → enemy properties (tight) |

---

## Summary Table: Issues by Severity

| Issue | Severity | Root Cause | File | Line | Impact |
|-------|----------|-----------|------|------|--------|
| Dual resistance sources | HIGH | Design | sandbox.js | 301 | Unpredictable behavior |
| God object (35+ properties) | HIGH | Accretion | main.js, waves.js, arenaMutations.js | Various | Hard to maintain, extend |
| Fragmented damage logic | MEDIUM | Code duplication | main.js, sandbox.js | 956-976, 296-325 | Inconsistent balance |
| Mixed concerns in updateEnemies | MEDIUM | Monolithic function | main.js | 877-978 | Hard to test, reuse |
| DOM on entity object | MEDIUM | Coupling | waves.js, main.js | 77, 769 | Brittle to UI changes |
| Inconsistent restart pattern | LOW | Pattern divergence | main.js, gameState.js | 809-867, 63-67 | Risk of state leaks |
| Type-specific state on generic object | LOW | Encapsulation | enemyAI.js | 67-140 | Confusing code |

---

## Next Steps

1. **Read full review**: `/ARCHITECTURE_REVIEW.md`
2. **Implement Priority 1**: Unify resistance source (30 min)
3. **Implement Priority 2**: Extract EnemyStatusManager (1.5 hrs)
4. **Implement Priority 3**: Unify damage pipelines (2 hrs)
5. **Implement Priority 4**: Remove DOM from entity (1 hr)

**Total effort**: 5-6 hours → Game becomes 3-4x easier to extend.

