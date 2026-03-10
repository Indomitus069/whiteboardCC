# Whiteboard CC

A minimal, fast, multiplayer whiteboard. Draw, point, vibe. Built with Next.js + tldraw on the frontend and Fastify WebSockets on the backend. No weird stuff, just clean realtime collab.

## TL;DR
- Run backend → run frontend → share the board link
- Laser pencil: press `L` or use the toggle, hold left mouse to draw
- Env for prod: set `NEXT_PUBLIC_WS_URL`, `DATABASE_URL`, `ALLOWED_ORIGIN`

## Features
- Realtime drawing and shape sync via our own WS backend
- Laser pencil (telestrator-style) that fades after ~5s
- Light/Dark theme toggle and canvas background picker
- Per-board snapshot storage (Postgres) with simple restore
- Resilient WS: heartbeat (PING/PONG), auto-reconnect, origin allowlist

## Stack
- Frontend: Next.js 14, React 18, `tldraw@^2.4`
- Backend: Fastify 4, `@fastify/websocket`, Node 20+
- Database: Postgres (Neon/Supabase/Railway etc.)

## Local Dev
Prereqs:
- Node 20+
- Optional: Postgres (only needed for snapshots)

Backend:
```bash
cd backend
npm ci
npm run dev
# Health: http://localhost:3001/health
```

Frontend:
```bash
cd frontend
npm ci
npm run dev
# App: http://localhost:3000
```

Open http://localhost:3000/board/<your-id> in two browsers to see realtime sync.

## Config (Env Vars)
Frontend:
- `NEXT_PUBLIC_WS_URL` → full WebSocket endpoint for prod, e.g. `wss://api.example.com`
- Or `NEXT_PUBLIC_WS_HOST` → host fallback, e.g. `api.example.com:443`

Backend:
- `PORT` → default `3001`
- `DATABASE_URL` → Postgres connection string
- `ALLOWED_ORIGIN` → your frontend origin, e.g. `https://whiteboard.example.com`

Security notes:
- We block connections if `origin` doesn’t match `ALLOWED_ORIGIN`
- Always use `wss://` when your frontend is on `https://` (mixed content is not the vibe)

## Database Setup
Run once:
```sql
CREATE TABLE IF NOT EXISTS board_snapshots (
  id BIGSERIAL PRIMARY KEY,
  board_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  compressed_state BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_snapshots_board_ts
  ON board_snapshots(board_id, ts DESC);
```

## Laser Pencil
- Toggle at bottom-center toolbar or top-right button
- Hotkey: `L`
- Hold left mouse to draw; strokes fade after ~5s
- Strokes sync live to other clients (presence messages)

## Deployment (Quick)
1) Backend (Render/Fly/Heroku or your VM)
   - Set `DATABASE_URL`, `ALLOWED_ORIGIN`, `PORT`
   - Enable WebSocket
   - Behind Nginx? Add `Upgrade/Connection: upgrade` for `/ws`
2) Frontend (Vercel or Node)
   - Set `NEXT_PUBLIC_WS_URL=wss://api.example.com`
3) Smoke test:
   - DevTools → Network → WS frames show steady PING/PONG
   - Two browsers on same board see each other’s drawings and laser

More details: [docs/deployment.md](docs/deployment.md)

## Troubleshooting
- Fastify “not installed”
  - `cd backend && npm ci`
- “await is only valid at top level”
  - Use Node 18+ or adjust to an async bootstrap function
- Laser not drawing
  - Ensure Laser is toggled On or press `L`
  - Click on canvas and hold left mouse; check no extra overlay intercepts clicks
- Mixed content warning
  - Frontend on `https://` → WebSocket must be `wss://`

## License
MIT — do cool stuff responsibly.
