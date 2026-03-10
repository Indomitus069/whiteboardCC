CREATE TABLE IF NOT EXISTS board_snapshots (
  id BIGSERIAL PRIMARY KEY,
  board_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  compressed_state BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_board_snapshots_board_ts ON board_snapshots(board_id, ts DESC);
