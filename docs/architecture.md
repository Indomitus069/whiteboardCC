# System Architecture

## High-Level Diagram
```
Client (Next.js + tldraw)
        |
     WebSocket
        |
 Node.js + Fastify Server
        |
 In-Memory Board State
        |
     PostgreSQL
```

## WebSocket Flow
```
Client A                 Server                    Clients B..N
--------                 ------                    -------------
edit object  ─────►  operation received  ─────►  broadcast operation
store update         apply to board state        update peers
convert to op        snapshot by count/time      consistent LWW
send via ws          presence updates            cursors/selections
```

## Synchronization Model
```
User edit
  ↓
tldraw store change
  ↓
delta operation
  ↓
WebSocket send
  ↓
Server apply (LWW)
  ↓
Broadcast to board peers
  ↓
Clients converge
```

## Data Model
```
BoardState {
  objects: { [id]: { id, version, data } },
  users:   { [userId]: Presence },
  operations: Operation[],
  opCountSinceSnapshot: number,
  lastSnapshotAt: number
}
```

## Snapshot Schema
```
board_snapshots (
  id BIGSERIAL PK,
  board_id TEXT,
  ts TIMESTAMPTZ,
  compressed_state BYTEA
)
```

## Concurrency and Conflict Resolution
- Versioned objects and operations
- Last Write Wins for deterministic convergence
- Idempotent ops via operationId + version

## Limits and Protection
- Rate limit per client: 100 ops/minute
- Max users per board: 100
- Max objects per board: 10,000

## Recovery
- Load latest snapshot on reconnect or server restart
- Rehydrate in-memory state before serving operations
