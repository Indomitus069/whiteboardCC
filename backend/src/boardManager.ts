import { BoardState, Operation, BoardObject, Presence } from './types.js'
import { v4 as uuidv4 } from 'uuid'

const MAX_OPERATIONS_BUFFER = 1000
const MAX_USERS_PER_BOARD = 100
const MAX_OBJECTS_PER_BOARD = 10000

export class BoardManager {
  private boards: Map<string, BoardState> = new Map()

  ensureBoard(boardId: string) {
    if (!this.boards.has(boardId)) {
      this.boards.set(boardId, {
        objects: {},
        users: {},
        operations: [],
        opCountSinceSnapshot: 0,
        lastSnapshotAt: Date.now()
      })
    }
    return this.boards.get(boardId)!
  }

  addPresence(boardId: string, presence: Presence) {
    const state = this.ensureBoard(boardId)
    if (Object.keys(state.users).length >= MAX_USERS_PER_BOARD) return
    state.users[presence.userId] = presence
  }

  removePresence(boardId: string, userId: string) {
    const state = this.ensureBoard(boardId)
    delete state.users[userId]
  }

  applyOperation(op: Operation): BoardObject | null {
    const state = this.ensureBoard(op.boardId)
    if (Object.keys(state.objects).length > MAX_OBJECTS_PER_BOARD) return null
    const existing = state.objects[op.objectId]
    if (op.type === 'CREATE_OBJECT') {
      if (existing && existing.version >= op.version) return null
      const obj: BoardObject = {
        id: op.objectId || uuidv4(),
        version: op.version,
        data: { ...(op.delta || {}) }
      }
      state.objects[obj.id] = obj
    } else if (op.type === 'DELETE_OBJECT') {
      if (!existing) return null
      if (existing.version > op.version) return null
      delete state.objects[op.objectId]
    } else {
      if (!existing) return null
      if (existing.version > op.version) return null
      const nextVersion = op.version
      const nextData = { ...existing.data, ...(op.delta || {}) }
      state.objects[op.objectId] = { id: op.objectId, version: nextVersion, data: nextData }
    }
    state.operations.push(op)
    if (state.operations.length > MAX_OPERATIONS_BUFFER) state.operations.shift()
    state.opCountSinceSnapshot += 1
    return state.objects[op.objectId] || null
  }

  getBoardState(boardId: string): BoardState {
    return this.ensureBoard(boardId)
  }

  setBoardState(boardId: string, state: BoardState) {
    this.boards.set(boardId, state)
  }
}
