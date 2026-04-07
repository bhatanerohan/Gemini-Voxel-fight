---
name: arena-layout-design
description: Design and implement combat arena layouts for this Three.js voxel shooter. Use when revising `src/arena.js`, replacing arena geometry, planning whitebox layouts, tuning sightlines and cover, adding height tiers, validating jumpable routes, or protecting spawn lanes during deathmatch map changes.
---

# Arena Layout Design

## Overview

Use this skill when the task is not just "edit boxes in `src/arena.js`" but "make the arena play better." Favor whitebox-first layouts that create clear landmarks, readable routes, purposeful cover, and verified traversal in the current repo.

## Workflow

1. Read the current arena block in `src/arena.js`.
2. Read `references/repo-constraints.md` before changing geometry.
3. Read `references/arena-heuristics.md` when deciding layout shape, cover density, or route flow.
4. Keep helper functions, materials, floor, grid, and outer boundary logic unless the task explicitly requires changing them.
5. Replace or adjust only the geometry section after the boundary walls whenever possible.
6. Implement the smallest whitebox that proves the design: landmark, routes, cover, and tier transitions.
7. Validate with:
   - `node --check src/arena.js`
   - `npm run build`
   - browser verification when possible: run the local dev server, use the Playwright client already present in this repo, inspect screenshots, and check console errors
8. Update `progress.md` with the arena goal, what changed, and any remaining traversal risks.

## Arena Rules

- Favor one strong central landmark and a small number of readable supporting structures.
- Keep the active combat space open enough for ranged fights; do not rebuild the arena into dense clutter.
- Use at most three intentional height tiers unless the user asks otherwise.
- Make flank routes obvious and meaningfully different from the center route.
- Use cover to create decisions, not maze walls. Players should understand where fights happen from a quick glance.
- When adding high ground, define the access path on purpose: stairs, jumpable ledge, or deliberate denial.
- Use `hotZoneMat` for the most contested central space when visual emphasis helps.

## Geometry Rules

- Prefer `addArenaBox(...)` for all whitebox pieces.
- Use `addStairRamp(...)` for reliable stair access instead of hand-placing mismatched steps.
- Only axis-aligned `walkable: true` boxes register as walkable surfaces. Rotated walkable boxes do not.
- Remember that walkable surface height is the top of the box: `y + sy * 0.5`.
- All collidable boxes become actor blockers. If a spawn point or route intersects a solid box, players will be pushed out of it.
- Keep spawn coordinates safe or intentionally snapped onto a clean walkable platform; do not leave players spawning inside stairs, pillars, or cover.
- When a route is supposed to be jumpable, keep the vertical delta within the project jump limit from `references/repo-constraints.md`.
- For uncertain horizontal jumps or seam-heavy transitions, do not assume they work. Verify them in browser.

## Output Expectations

When making an arena change, leave behind:

1. A coherent whitebox layout in `src/arena.js`
2. A short explanation of the layout intent
3. Validation status, including what was and was not tested

## References

- `references/repo-constraints.md`
- `references/arena-heuristics.md`
