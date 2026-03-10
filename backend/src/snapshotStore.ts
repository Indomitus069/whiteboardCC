import { Pool } from 'pg'
import { BoardState, SnapshotRecord } from './types.js'
import { gzipSync, gunzipSync } from 'zlib'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

export async function saveSnapshot(boardId: string, state: BoardState) {
  const payload = Buffer.from(JSON.stringify(state), 'utf-8')
  const compressed = gzipSync(payload)
  const timestamp = Date.now()
  const client = await pool.connect()
  try {
    await client.query(
      'INSERT INTO board_snapshots (board_id, ts, compressed_state) VALUES ($1, to_timestamp($2/1000.0), $3)',
      [boardId, timestamp, compressed]
    )
  } finally {
    client.release()
  }
}

export async function loadLatestSnapshot(boardId: string): Promise<BoardState | null> {
  const client = await pool.connect()
  try {
    const res = await client.query(
      'SELECT compressed_state FROM board_snapshots WHERE board_id = $1 ORDER BY ts DESC LIMIT 1',
      [boardId]
    )
    if (res.rowCount === 0) return null
    const buf: Buffer = res.rows[0].compressed_state
    const json = gunzipSync(buf).toString('utf-8')
    const state: BoardState = JSON.parse(json)
    return state
  } finally {
    client.release()
  }
}
