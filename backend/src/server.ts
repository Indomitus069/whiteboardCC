import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { BoardManager } from './boardManager.js'
import { RateLimiter } from './rateLimiter.js'
import { saveSnapshot, loadLatestSnapshot } from './snapshotStore.js'
import { Operation, Presence } from './types.js'

const fastify = Fastify({ logger: true })
await fastify.register(websocket)

const boardManager = new BoardManager()
const rateLimiter = new RateLimiter(100)

type ClientMeta = { boardId: string; userId: string }
const connections: Map<string, Set<any>> = new Map()
const clientMeta: Map<any, ClientMeta> = new Map()

fastify.get('/health', async () => ({ ok: true }))

fastify.get('/api/board/:boardId', async (req: any, reply: any) => {
  const { boardId } = req.params
  const state = boardManager.getBoardState(boardId)
  if (state.opCountSinceSnapshot > 0 || Object.keys(state.objects).length > 0) {
      return { exists: true }
  }
  const snapshot = await loadLatestSnapshot(boardId)
  if (snapshot) {
    return { exists: true }
  }
  return { exists: false }
})

fastify.get('/ws', { websocket: true }, (connection: any, req: any) => {
  const url = new URL(req.protocol + '://' + req.headers.host + req.raw.url)
  const boardId = url.searchParams.get('boardId') || 'default'
  const userId = url.searchParams.get('userId') || Math.random().toString(36).slice(2)
  const ws: any = connection.socket
  const allowed = process.env.ALLOWED_ORIGIN
  const origin = req.headers.origin as string | undefined
  if (allowed && origin && origin !== allowed) {
    try { ws.close(1008, 'origin not allowed') } catch {}
    return
  }

  if (!connections.has(boardId)) connections.set(boardId, new Set())
  connections.get(boardId)!.add(ws)
  clientMeta.set(ws, { boardId, userId })

  loadLatestSnapshot(boardId).then(state => {
    if (state) boardManager.setBoardState(boardId, state)
    const fullState = boardManager.getBoardState(boardId)
    ws.send(JSON.stringify({ type: 'INIT', state: fullState }))
  }).catch(() => {})

  boardManager.addPresence(boardId, { userId } as Presence)
  broadcast(boardId, { type: 'PRESENCE_JOIN', userId })

  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  const interval = setInterval(() => {
    if (ws.isAlive === false) {
      try { ws.terminate() } catch {}
      clearInterval(interval)
      return
    }
    ws.isAlive = false
    try { ws.ping() } catch {}
  }, 30000)

  ws.onmessage = (ev: any) => {
    const meta = clientMeta.get(ws)
    if (!meta) return
    const key = meta.userId
    if (!rateLimiter.allow(key)) return
    let msg
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      return
    }
    if (msg.type === 'PING') {
      try { ws.send(JSON.stringify({ type: 'PONG', t: Date.now() })) } catch {}
    } else if (msg.type === 'OP') {
      const op: Operation = msg.payload
      const applied = boardManager.applyOperation(op)
      if (applied) broadcast(meta.boardId, { type: 'OP_APPLIED', payload: op })
      const state = boardManager.getBoardState(meta.boardId)
      const now = Date.now()
      const shouldSnapshotByCount = state.opCountSinceSnapshot >= 100
      const shouldSnapshotByTime = now - state.lastSnapshotAt >= 30_000
      if (shouldSnapshotByCount || shouldSnapshotByTime) {
        state.opCountSinceSnapshot = 0
        state.lastSnapshotAt = now
        saveSnapshot(meta.boardId, state).catch(() => {})
      }
    } else if (msg.type === 'PRESENCE') {
      const presence: Presence = { userId: meta.userId, ...msg.payload }
      boardManager.addPresence(meta.boardId, presence)
      broadcast(meta.boardId, { type: 'PRESENCE_UPDATE', payload: presence })
    }
  }

  ws.onclose = () => {
    const meta = clientMeta.get(ws)
    if (!meta) return
    clearInterval(interval)
    connections.get(meta.boardId)?.delete(ws)
    clientMeta.delete(ws)
    boardManager.removePresence(meta.boardId, meta.userId)
    broadcast(meta.boardId, { type: 'PRESENCE_LEAVE', userId: meta.userId })
  }
})

function broadcast(boardId: string, message: unknown) {
  const peers = connections.get(boardId)
  if (!peers) return
  const payload = JSON.stringify(message)
  for (const ws of peers) {
    try {
      ws.send(payload)
    } catch {}
  }
}

const port = Number(process.env.PORT || 3001)
fastify.listen({ port, host: '0.0.0.0' })
