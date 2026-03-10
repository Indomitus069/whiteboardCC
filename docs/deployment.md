# Deployment Guide (Free Tier)

## Prerequisites
- Accounts on Vercel, Render or Railway, and Neon or Supabase
- Database URL provisioned (DATABASE_URL)

## Database (Neon or Supabase)
- Create a PostgreSQL project
- Obtain connection string (prefer pooled connection)
- Run schema:
```
-- in SQL editor
CREATE TABLE IF NOT EXISTS board_snapshots (
  id BIGSERIAL PRIMARY KEY,
  board_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  compressed_state BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_board_snapshots_board_ts ON board_snapshots(board_id, ts DESC);
```

## Backend (Render or Railway)
- Create a new Node service from repository path backend
- Environment variables:
  - PORT=3001
  - DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB
- Build command:
  - npm i
  - npm run build
- Start command:
  - npm run start
- Enable WebSocket support
- Note the public URL

## Frontend (Vercel)
- Import repository path frontend
- Environment variable:
  - NEXT_PUBLIC_WS_HOST=<backend-host:port or domain>
- Build settings:
  - npm i
  - npm run build
- Set framework to Next.js
- Deploy

## Testing
- Open https://your-frontend.vercel.app
- Create a board and share URL /board/{boardId}
- Connect from multiple browsers and verify real-time sync

## Cost Notes
- Free tiers may sleep services when idle
- Consider periodic pings if necessary
- Scale up with Redis and multi-instance backend when moving beyond free tier
