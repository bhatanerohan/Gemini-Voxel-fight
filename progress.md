Original prompt: i though we aren't using 2 stage weapon generator? / yes do it

- Switched weapon forge flow to single-stage generation in src/forge.js (direct request -> CODER_PROMPT -> compile).
- Removed architect-plan parsing/display-name dependency; weapon name now uses the user's prompt text.
- Updated CODER_PROMPT wording in src/prompt.js to allow raw player requests as input.
- Playwright validation not run: no local Playwright binary present in this repo (node_modules/.bin/playwright.cmd missing).
- Implemented minimal engine/status API support: enemy freeze/slow/stun/burn state, new ctx enemy methods, findEnemiesInCone, applyRadialForce, and CODER_PROMPT docs.
- Verified with npm run build (outside sandbox due esbuild spawn EPERM in sandbox).
- Created standalone weapon SDK draft modules in `src/weaponSdk/` (targeting, damage, status, force, visuals, timing) plus `weapon_sdk_v1.md`.
- Intentionally not wired into `src/sandbox.js` yet; next step is runtime-adapter wiring + prompt docs update.
- Wired Weapon SDK into `src/sandbox.js`: helpers are now exposed on `ctx.sdk` and also flattened onto `ctx` when names do not conflict.
- Added `ctx.findLineHits(...)` (via Weapon SDK) for beam/ray hit metadata and updated `src/prompt.js` to prefer SDK helpers first, including beam endpoint coupling guidance.
- Strengthened `src/prompt.js` with an internal single-stage `weapon_intent_spec` planning schema (do-not-output) plus exact SDK signatures/return shapes and common misuse warnings (beam/impact/status call shapes, line-hit `t`, particle size scale).
- Added `weapon_sdk_manifest.json` as a deterministic SDK manifest (24 helpers) with exact call shapes, return schemas, common LLM mistake/repair rules, and archetype examples for retrieval/validation pipelines.


- Implemented `findLineHits` tolerance improvements in `src/weaponSdk/targeting.js`:
  - accepts `radius` as alias for `width`
  - accepts `sortBy: "t"` as alias for `"along"`
  - added optional `ignoreY` for XZ-plane line checks
  - added optional `inflate` and `targetRadius` to widen beam hit tolerance
- Validation: `node --check src/weaponSdk/targeting.js`, `node --check src/sandbox.js`, `node --check src/main.js`, and `npm run build` all passed.
- Enforced intent-first prompting for weapon generation:
  - Updated `src/forge.js` coder input to explicitly treat player text as gameplay intent only and to avoid requiring SDK/API names from players.
  - Updated `src/prompt.js` with explicit rule that implementation method selection is model-owned (do not depend on player-provided API function names).
- Validation: `node --check src/forge.js`, `node --check src/prompt.js`, and `npm run build` passed.
- Freeze-beam stop-on-hit reliability fixes:
  - Updated `src/weaponSdk/targeting.js` `queryLineHits` to be more tolerant:
    - accepts `sortBy: "t"` alias for `"along"`
    - accepts `radius` alias for `width`
    - supports `inflate`, `targetRadius`, `ignoreY`
    - automatic fallback pass with `ignoreY=true` when no hits and `ignoreY` not explicitly set
  - Updated `src/weaponSdk/timing.js` `spawnBeamTick` to couple visual endpoint with resolved hits by default for non-piercing beams:
    - default endpoint mode clamps to first hit
    - effect range (damage/status/force cones) is clamped to first-hit distance when stop-on-hit behavior is active
  - Updated `src/weaponSdk/index.js` so timing helper receives targeting dependency.
- Validation: `node --check` passed for modified SDK files; `npm run build` passed.
- Fixed runtime crash for generated weapons using `THREE.CapsuleGeometry`:
  - Added compatibility shim in `src/sandbox.js` so `ctx.THREE.CapsuleGeometry` exists even on Three r128.
  - Shim approximates capsule with a cylinder-based geometry so weapon generation does not hard-fail.
- Tightened generation guidance in `src/prompt.js`:
  - Explicitly discourages CapsuleGeometry and prefers r128-safe geometry primitives.
- Validation: `node --check src/sandbox.js`, `node --check src/prompt.js`, `npm run build` all passed.

- Switched actor visuals from cars to voxel humans in `src/main.js`:
  - Added `createVoxelHumanoid(...)` helper and replaced both player + enemy mesh construction.
  - Kept all movement/combat/runtime logic unchanged to avoid behavior regressions.
  - Raised enemy health-bar label anchor to `y=2.25` for taller character models.
- Updated UI naming in `index.html` from car-themed text to `Voxel Arena - AI Weapons` and cleaned mojibake title/forge header text.
- Updated `src/prompt.js` theme/scale wording from car combat to voxel human combat so generated weapon sizing intent matches new actor scale.
- Validation: `node --check src/main.js`, `node --check src/prompt.js`, and `npm run build` passed.
- Playwright validation attempted via skill script but blocked because package `playwright` is not installed (ERR_MODULE_NOT_FOUND from `web_game_playwright_client.js`).

- Added procedural walking animation rig for voxel humans in `src/main.js`:
  - `createVoxelHumanoid(...)` now builds limb pivots (arms/legs), head pivot, and stores a rig in `mesh.userData.rig`.
  - Added `animateHumanoid(...)` to drive stride, arm swing, torso twist, and bob from horizontal speed.
  - Wired animation updates into both `updatePlayer(...)` and `updateEnemies(...)`.
  - Frozen enemies now animate as frozen/idle (no active stride cycle).
- Validation: `node --check src/main.js` and `npm run build` passed.
- Playwright gameplay validation re-attempted; still blocked by missing `playwright` package (ERR_MODULE_NOT_FOUND).

- Reduced overall glow intensity in scene and combat effects:
  - `src/main.js`: lowered tonemapping exposure (`1.1 -> 0.98`), reduced bloom strength/threshold tuning, reduced boundary strip emissive intensity, reduced player suit emissive, and reduced visor emissive intensity.
  - `src/sandbox.js`: reduced default enemy-hit flash emissive intensity, reduced death-effect point light intensity, and lowered default `ctx.explode` light intensity.
- Validation: `node --check src/main.js`, `node --check src/sandbox.js`, and `npm run build` passed.

- Follow-up correction based on user feedback ("weapon brightness when fired", not arena lighting):
  - Restored arena/global lighting values in `src/main.js` (tone mapping exposure, bloom settings, boundary strip emissive, player/visor emissive) back to prior levels.
  - Added weapon-effect brightness caps in `src/sandbox.js`:
    - caps for spawned mesh emissive intensity (via `sanitizeObjectGlow`)
    - caps for weapon-added point lights (`sanitizeLight`)
    - caps for weapon particle bursts (`sanitizeParticleBurstOpts`) applied to `ctx.burstParticles`, `ctx.explode`, and death effects
    - reduced full-screen flash strength on explosions/death flashes.
  - Reduced particle apparent brightness in `src/particles.js` by lowering particle alpha in shader and initial per-particle alpha.
  - Tuned SDK visual defaults in `src/weaponSdk/visuals.js` to be less over-bright (lower default opacities, lighter impact-burst defaults).
  - Updated prompt guidance in `src/prompt.js` to prefer lower emissive ranges and moderate particle/light counts.
- Validation: `node --check src/main.js`, `src/sandbox.js`, `src/particles.js`, `src/weaponSdk/visuals.js`, `src/prompt.js`, and `npm run build` passed.

- Reverted the previous "weapon brightness cap" follow-up changes per user request.
  - Removed runtime sanitize caps/hooks from `src/sandbox.js`.
  - Restored `src/particles.js`, `src/weaponSdk/visuals.js`, and `src/prompt.js` values/rules to prior state.
  - Restored `src/main.js` to the prior dimmed-arena settings from the earlier glow pass.
- Validation: `node --check` passed for all touched files and `npm run build` passed.

- Added mouse-driven aim locomotion in `src/main.js`:
  - Player yaw now tracks mouse aim projected onto the ground plane (`updateAimLocomotion`), and movement remains WASD relative to aim direction.
  - Removed old Q/E and mouse-drag rotation controls; left mouse now only controls firing.
  - Added directional locomotion blending to `animateHumanoid(...)` (forward/back stride direction + strafe lean/spread).
  - Crosshair now follows the mouse cursor to match aim direction.
- Updated HUD text in `index.html` to reflect mouse aim locomotion controls.
- Validation: `node --check src/main.js` and `npm run build` passed.
- Playwright gameplay validation attempted again; blocked by missing `playwright` package (ERR_MODULE_NOT_FOUND).

- Created new session handoff summary:
  - `session_handoff_2026-02-27.md`

- Reworked aim locomotion camera toward an over-the-shoulder third-person setup in `src/main.js`:
  - Replaced the high chase camera with a lower/closer shoulder rig plus smoothed position/look damping.
  - Added camera occlusion handling against arena walls and obstacle meshes so the camera pulls in instead of clipping through geometry.
  - Changed mouse aim resolution to raycast against world obstacles first, then fall back to ground-plane / far-ray aiming, which is a better fit for the lower third-person camera angle.
  - Tightened camera framing via FOV reduction (`65 -> 60`) and centered the crosshair state on init/resize.
- Validation: `node --check src/main.js` and `npm run build` passed.
- Research basis for the camera direction:
  - official third-person shoulder-follow guidance from Unity Cinemachine docs
  - spring-arm collision guidance from Godot `SpringArm3D` docs
  - third-person camera boom/collision pattern from Unreal spring arm docs
- Playwright validation still blocked in this environment because the `playwright` package is not installed.

- Lowered the shared player firing origin in `src/sandbox.js`:
  - `ctx.player.getPosition()` now returns a torso-height shoot origin instead of the ground/root position.
  - Added `ctx.player.getShootOrigin()` and `ctx.player.getFeetPosition()` so generated weapons can explicitly choose torso vs root origin.
  - Updated `src/prompt.js` API docs to describe the new player origin helpers.
- Validation: `node --check src/sandbox.js`, `node --check src/prompt.js`, and `npm run build` passed.

- Fixed unintended auto-rotation / side drift in aim locomotion:
  - `src/main.js` now caches a target aim yaw only when the mouse position changes instead of recomputing a new aim yaw every frame from the moving follow camera.
  - This removes the camera/aim feedback loop that caused rotation or side drift while the mouse was stationary.
- Validation: `node --check src/main.js` and `npm run build` passed.

- Raised the third-person camera slightly in `src/main.js`:
  - Increased `CAMERA_RIG.shoulderUp`, `followHeight`, and `lookHeight` for a modestly higher framing without changing the overall shoulder-cam style.
- Validation: `node --check src/main.js` and `npm run build` passed.

- Added a permanent integrated right-forearm muzzle gauntlet for the player in `src/main.js`:
  - attached a bulky muzzle shell to the player rig instead of generating a separate held weapon mesh
  - added a dedicated muzzle socket on the gauntlet for beam/projectile spawn positions
  - shifted the player weapon arm into a steadier combat pose so the gauntlet reads as worn/integrated instead of swinging like a normal hand
- Updated `src/sandbox.js` player origin helpers:
  - `ctx.player.getPosition()` and `ctx.player.getShootOrigin()` now resolve from the gauntlet muzzle with torso fallback
  - added `ctx.player.getTorsoPosition()` for body-centered effects
- Updated `src/prompt.js` API docs to reflect the new muzzle-based shoot origin semantics.
- Validation: `node --check src/main.js`, `node --check src/sandbox.js`, `node --check src/prompt.js`, and `npm run build` passed.
- Browser/gameplay validation not run per user preference.

- Refined the player gauntlet cannon in `src/main.js` to better match the provided visual reference:
  - enlarged the forearm shell into a more dominant integrated cannon silhouette
  - replaced the simple muzzle with stacked telescoped barrel sections and a clearer front ring/cap
  - adjusted the weapon-arm pose to present the cannon more forward and less drooped
- Validation: `node --check src/main.js` and `npm run build` passed.

- Upgraded aiming to use the full crosshair ray instead of flat left/right yaw only:
  - `src/sandbox.js` now exposes `ctx.player.getAimPoint()` and makes `ctx.player.getDirection()` return full 3D aim from the muzzle to the crosshair hit point
  - added `ctx.player.getFacingDirection()` to preserve access to flat body facing on XZ when needed
  - `src/main.js` now derives and smooths aim pitch from the same crosshair target so the integrated cannon can raise/lower toward the aim direction
- Updated `src/prompt.js` player API docs to reflect the new 3D aim semantics.

- Removed the manual Gemini key-entry gate:
  - `src/forge.js` now reads `VITE_GEMINI_API_KEY` from Vite env at startup
  - `src/main.js` now boots immediately instead of waiting for UI key entry
  - `index.html` no longer shows the API key prompt screen
  - missing-key errors now direct the user to `.env`
- Validation: `node --check src/main.js`, `node --check src/forge.js`, and `npm run build` passed.

- Replaced the placeholder `README.md` with a proper project README:
  - installation and run instructions
  - `.env` / Gemini API key setup
  - controls and weapon-forge usage
  - example prompts
  - project structure
  - local-vs-production deployment caveats for the current Gemini proxy setup
