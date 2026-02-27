# Voxel Arena - AI Weapons

A browser-based third-person voxel combat prototype built with `Three.js` and `Vite`.

The core idea is simple:
- you control a voxel fighter in a small arena
- you open the Weapon Forge
- you describe a weapon in natural language
- Gemini generates the weapon behavior live
- the game compiles that code and equips it immediately

## Features

- Third-person voxel arena combat
- Mouse-driven aim with over-the-shoulder camera
- Integrated forearm cannon muzzle on the player
- AI-generated weapons through Gemini
- Runtime weapon sandbox/context with reusable SDK helpers
- Status effects like freeze, stun, slow, burn, force, beams, explosions, trails, and particles

## Tech Stack

- `Vite`
- `Three.js`
- plain JavaScript modules
- Gemini API through the OpenAI-compatible endpoint

## Requirements

- Node.js 18+ recommended
- npm
- A Gemini API key

## Setup

### 1. Install packages

```bash
npm install
```

### 2. Add your Gemini API key

This project reads the key from a local `.env` file.

The repo already includes:
- [`.env.example`](./.env.example)

create a `.env` file
Open `.env` and set:

```env
VITE_GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

If you prefer, you can copy `.env.example` into `.env` and fill it in.

## Run Locally

Start the Vite dev server:

```bash
npm run dev
```

Then open the local URL shown by Vite, usually:

```text
http://localhost:5173
```

## Build

Create a production build:

```bash
npm run build
```

The output goes to `dist/`.

## Controls

- `WASD`: move
- `Mouse`: aim
- `Hold Left Click`: fire
- `T`: open Weapon Forge
- `Esc`: close Weapon Forge

## How The Weapon Forge Works

1. Press `T`
2. Type a weapon idea in plain English
3. Gemini generates the weapon code
4. The game compiles it and equips it instantly

When a weapon is generated, the browser console logs:
- the Gemini model used
- generation time in milliseconds
- the generated weapon code

## Example Weapon Prompts

Try prompts like these:

- `a black hole cannon that pulls enemies inward and crushes them`
- `a freeze beam that stops on first hit and leaves icy bursts`
- `a rapid plasma rifle with small blue bolts and light recoil`
- `a lightning cannon that chains between nearby enemies`
- `Pizza`
- `Arrow`
- `Homing missile`

## Project Structure

- [`src/main.js`](./src/main.js): scene setup, player, enemies, camera, controls, aiming, humanoid rig
- [`src/sandbox.js`](./src/sandbox.js): runtime context passed to generated weapons
- [`src/forge.js`](./src/forge.js): Gemini request flow and weapon compilation
- [`src/prompt.js`](./src/prompt.js): system prompt and weapon-generation rules
- [`src/weaponSdk/`](./src/weaponSdk): reusable targeting, damage, status, force, timing, and visuals helpers
- [`progress.md`](./progress.md): running implementation notes and handoff history

## Environment Notes

The Gemini key is currently read from `VITE_GEMINI_API_KEY`.

Important implication:
- this is convenient for local development
- but `VITE_` variables are exposed to the client bundle

So this setup is fine for local/dev use, but not ideal for a public production deployment with your own secret key.

For production hosting, the better pattern is:
- keep the Gemini API key on the server
- call Gemini through a backend endpoint or serverless function

## Current Production Caveat

The project currently uses the Vite dev proxy in [`vite.config.js`](./vite.config.js) for `/gemini`.

That means:
- local development works
- a static production deploy will build successfully
- but AI weapon generation will not work in production unless you add a real backend/function/proxy

If you deploy this to Vercel, Netlify, or similar, the frontend will load, but the Gemini forge needs a server-side route to stay functional.

## Troubleshooting

### Weapon Forge says the Gemini key is missing

Make sure `.env` contains:

```env
VITE_GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Then restart `npm run dev`.

### Weapon generation works locally but not after deployment

That is expected with the current setup.

Reason:
- local dev uses the Vite proxy
- production does not

Fix:
- add a backend/serverless Gemini proxy

### Performance drops with flashy weapons

Very effect-heavy prompts can create lots of particles, lights, beams, and trails.

Safer prompt style:
- ask for strong behavior
- keep visual wording controlled
- avoid phrases like `constant giant explosions everywhere`

## Notes

- Generated weapons run against a game-specific runtime context, not arbitrary filesystem access.
- The player weapon now fires from the integrated forearm cannon muzzle instead of a generic body-center point.
- The aim direction uses the crosshair-aligned 3D aim ray, not just flat left/right yaw.

## License / Status

This is currently a prototype/hackathon-style project and does not include a formal license file in the repo.
