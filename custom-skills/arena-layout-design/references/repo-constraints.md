# Repo Constraints

Use these facts before changing arena geometry.

## Geometry API

- Arena geometry lives in `src/arena.js`.
- Preferred helpers:
  - `addArenaBox(...)` for boxes, pillars, cover, and platforms
  - `addTrimPlate(...)` for visual accents only
  - `addStairRamp(...)` for stepped traversal
- Preserve the floor, grid, strip, and boundary wall setup unless the task explicitly changes arena scale or boundary behavior.

## Movement And Collision

- Player collision radius is `0.55` in `resolveActorCollisions(...)` in `src/main.js`.
- Player jump is defined by:
  - `PLAYER_JUMP_SPEED = 10.5`
  - `PLAYER_GRAVITY = 28`
- Vertical jump peak is about `1.97` world units. Use that as the maximum intended jump-up delta.
- Actor collision tests use AABBs generated from every collidable arena mesh.
- Player floor height comes from the highest matching walkable surface at that `(x, z)`.

## Walkable Surface Rules

- `addArenaBox(..., walkable: true)` creates a walkable surface only when rotation is zero on all axes.
- Walkable height is the box top: `y + sy * 0.5`.
- `surfaceInset` shrinks the usable walkable footprint. Tight platforms need a small inset.
- `addStairRamp(...)` creates stepped, walkable boxes; use it for consistent tier access.

## Spawn Rules

- Spawn points are in `src/gameConfig.js`.
- Blue spawn coordinates:
  - `(-34, -44)`, `(-16, -42)`, `(0, -40)`, `(16, -42)`, `(34, -44)`
- Red spawn coordinates:
  - `(-34, 44)`, `(-16, 42)`, `(0, 40)`, `(16, 42)`, `(34, 44)`
- Respawns use `getArenaFloorHeight(x, z) + 0.6`, so a spawn can land on a platform if that platform is intentionally walkable at the spawn location.
- Do not leave partial stairs, thin blockers, or pillars intersecting these spawn coordinates.

## Validation

- Minimum validation:
  - `node --check src/arena.js`
  - `npm run build`
- Strong validation:
  - run the local dev server
  - use `output/web_game_playwright_client.js`
  - inspect screenshots
  - review console errors
- Record the validation result in `progress.md`.
