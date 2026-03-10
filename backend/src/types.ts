export type OperationType = 'CREATE_OBJECT' | 'UPDATE_OBJECT' | 'MOVE_OBJECT' | 'DELETE_OBJECT'

export type Operation = {
  operationId: string
  type: OperationType
  boardId: string
  objectId: string
  delta: Record<string, unknown>
  version: number
  userId: string
  timestamp: number
}

export type Presence = {
  userId: string
  username?: string
  cursorPosition?: { x: number; y: number }
  selectedObjects?: string[]
}

export type BoardObject = {
  id: string
  version: number
  data: Record<string, unknown>
}

export type BoardState = {
  objects: Record<string, BoardObject>
  users: Record<string, Presence>
  operations: Operation[]
  opCountSinceSnapshot: number
  lastSnapshotAt: number
}

export type SnapshotRecord = {
  boardId: string
  timestamp: number
  compressedState: Buffer
}
