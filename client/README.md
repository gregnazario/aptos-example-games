# Aptos Tic-Tac-Toe client

TanStack Start app for the on-chain tic-tac-toe game.

```
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

| Script | What it does |
| --- | --- |
| `npm start` / `npm run dev` | Vite + TanStack Start dev server |
| `npm run build` | Production build (Nitro) |
| `npm run serve` | Preview the production build |
| `npm run typecheck` | TypeScript check |

Game reads go through a Start server function (`src/functions/game.ts`). Moves
are signed in the browser with the Aptos wallet adapter.

Netlify deploys with `NITRO_PRESET=netlify` (publish directory `dist`, Node 22).
Local production preview still uses `npm run start:prod` against `.output/`.
