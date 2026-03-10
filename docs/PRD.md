# Product Requirements Document (PRD)

## Overview
- Real-time collaborative whiteboard running on free-tier infrastructure
- Operation-based synchronization over WebSockets
- tldraw-powered canvas editor
- Redis-less architecture using in-memory board state + PostgreSQL snapshot persistence

## Goals
- Enable real-time multi-user drawing collaboration
- Support 50–100 concurrent users per board
- Maintain <100ms synchronization latency
- Persist boards using PostgreSQL
- Run entirely on free infrastructure
- Minimize infrastructure complexity and operational cost
- Reliable recovery after server restart

## Target Users
- Students, developers, teams
- Secondary: teachers, remote visual collaboration

## Core Features
- Shared real-time canvas: shapes, text, arrows, lines, freehand, images
- Operation types: CREATE_OBJECT, UPDATE_OBJECT, MOVE_OBJECT, DELETE_OBJECT
- Board system: create, share URL /board/{boardId}, join, leave, persist
- Live presence: cursors, participants, selection state (server memory only)

## System Architecture
- Frontend: Next.js + tldraw
- Transport: WebSockets
- Backend: Node.js + Fastify
- State: In-memory per-board
- Persistence: PostgreSQL snapshots (gzip compressed)

## Synchronization Model
- User edits object → tldraw store updates → convert to operation delta → send via WebSocket → server applies update → broadcast to peers
- Example operation:
```
{ "type": "UPDATE_OBJECT", "boardId": "abc123", "objectId": "shape1", "delta": { "x":120, "y":300 }, "version": 4 }
```

## In-Memory Board State
```
boards = {
  boardId: {
    objects: {},
    users: {},
    operations: []
  }
}
```

## Concurrency Handling
- Idempotent operations: operationId + version
- Object versioning: objectId + version
- Conflict resolution: Last Write Wins

## Abuse Protection
- Rate limiting: 100 operations per minute per client
- Resource limits: max users per board = 100; max objects per board = 10,000

## Performance Targets
- Message latency <100ms
- 50–100 concurrent users per board
- Board size up to 10k objects
- Uptime 99% target

## Persistence Strategy
- Snapshots: every 100 operations or every 30 seconds
- Snapshot format:
```
{ boardId, timestamp, compressedState }
```
- Compression: gzip

## Board Recovery
- Server restart → client reconnects → server loads latest snapshot → board restored

## Free Deployment Plan
- Frontend: Vercel
- Backend: Render or Railway
- Database: Neon or Supabase PostgreSQL

## Cost Strategy
- Remove Redis
- Use in-memory board state
- Snapshot persistence only
- TTL cleanup for inactive boards (e.g., >24h deleted)

## Limitations
- No cross-server synchronization
- Single backend instance
- Suitable for personal projects, portfolios, moderate usage

## Future Improvements
- Redis for distributed scaling
- Operational log replay
- CRDT synchronization
- Board version history
- Real-time chat
- Export to PNG/PDF
