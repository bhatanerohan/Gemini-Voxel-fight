# Voxel Arena - AI Weapons

A browser-based third-person voxel combat prototype built with `Three.js` and `Vite`.

The core idea is simple:
- you control a voxel fighter in a small arena
- you open the Weapon Forge
- you describe a weapon in natural language
- OpenAI generates the weapon behavior live
- the game compiles that code and equips it immediately

## Features

- Third-person voxel arena combat
- Mouse-driven aim with over-the-shoulder camera
- Integrated forearm cannon muzzle on the player
- AI-generated weapons through OpenAI
- Runtime weapon sandbox/context with reusable SDK helpers
- Status effects like freeze, stun, slow, burn, force, beams, explosions, trails, and particles

## Tech Stack

- `Vite`
- `Three.js`
- plain JavaScript modules
- OpenAI API through the Vite dev proxy

## Requirements

- Node.js 18+ recommended
- npm
- An OpenAI API key

## Setup

### 1. Install packages

```bash
npm install
```

### 2. Add your OpenAI API key

This project reads the key from a local `.env` file.

The repo includes [`.env.example`](./.env.example).

Create `.env` in the project root and set:

```env
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

You can copy `.env.example` into `.env` and fill it in.

## Run Locally

Start the Vite dev server:

```bash
npm run dev
```

Then open the local URL shown by Vite, usually:

```text
http://localhost:5173
```

## Co-op Modes

### Local tabs on one machine

Open two tabs with the same room and different names:

```text
http://localhost:5173/?coop=1&room=alpha&name=PilotA
http://localhost:5173/?coop=1&room=alpha&name=PilotB
```

This mode uses `BroadcastChannel`, so it only works within the same browser profile / machine.

### Network co-op over WebSocket

Start the co-op room server in a second terminal:

```bash
npm run coop-server
```

By default it listens on:

```text
ws://0.0.0.0:8787
```

Then open the game with a `server` parameter pointing at the machine running the co-op server:

```text
http://192.168.1.42:5173/?coop=1&room=alpha&name=PilotA&server=ws://192.168.1.42:8787
http://192.168.1.42:5173/?coop=1&room=alpha&name=PilotB&server=ws://192.168.1.42:8787
```

You can also use:

```text
?server=auto
```

which resolves to `ws://<current-host>:8787` on `http` pages and `wss://<current-host>:8787` on `https` pages.

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
- `G`: cycle graphics quality
- `Esc`: close Weapon Forge

## How The Weapon Forge Works

1. Press `T`
2. Type a weapon idea in plain English
3. OpenAI generates the weapon code
4. The game compiles it and equips it instantly

When a weapon is generated, the browser console logs:
- the OpenAI model used
- generation time in milliseconds
- the generated weapon code

## Example Weapon Prompts

Try prompts like these:

- `a black hole cannon that pulls enemies inward and crushes them`
- `a freeze beam that stops on first hit and leaves icy bursts`
- `a rapid plasma rifle with small blue bolts and light recoil`
- `a lightning cannon that chains between nearby enemies`
- `a bouncing laser that ricochets off walls twice`
- `a gravity hammer blast fired from the arm cannon`
- `a missile swarm that launches in short bursts`
- `a flame thrower cone with heavy close-range burn damage`

## Project Structure

- [`src/main.js`](./src/main.js): scene setup, player, enemies, camera, controls, aiming, humanoid rig
- [`src/sandbox.js`](./src/sandbox.js): runtime context passed to generated weapons
- [`src/forge.js`](./src/forge.js): OpenAI request flow and weapon compilation
- [`src/prompt.js`](./src/prompt.js): system prompt and weapon-generation rules
- [`src/weaponSdk/`](./src/weaponSdk): reusable targeting, damage, status, force, timing, and visuals helpers
- [`progress.md`](./progress.md): running implementation notes and handoff history

## Environment Notes

The frontend no longer reads the OpenAI key directly.

Local development now works like this:
- the browser calls `/openai/chat/completions`
- the Vite dev proxy in [`vite.config.js`](./vite.config.js) reads `OPENAI_API_KEY` server-side
- the proxy adds the upstream `Authorization` header before forwarding the request

Important implication:
- `OPENAI_API_KEY` is not exposed to the client bundle
- using `VITE_OPENAI_API_KEY` for secrets is incorrect and should be avoided

For production hosting, use the same pattern:
- keep the OpenAI API key on the server
- call OpenAI through a backend endpoint or serverless function

## Current Production Caveat

The project currently uses the Vite dev proxy in [`vite.config.js`](./vite.config.js) for `/openai`.

That means:
- local development works when `OPENAI_API_KEY` is set in `.env`
- a static production deploy will build successfully
- but AI weapon generation will not work in production unless you add a real backend/function/proxy

If you deploy this to Vercel, Netlify, or similar, the frontend will load, but the OpenAI forge needs a server-side route to stay functional.

## Troubleshooting

### Weapon Forge says the OpenAI key is missing

Make sure `.env` contains:

```env
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
```

Then restart `npm run dev`.

The key must be available to the Vite dev server, not the browser bundle.

### Weapon generation works locally but not after deployment

That is expected with the current setup.

Reason:
- local dev uses the Vite proxy
- production does not

Fix:
- add a backend/serverless OpenAI proxy

### Performance drops with flashy weapons

Very effect-heavy prompts can create lots of particles, lights, beams, and trails.
