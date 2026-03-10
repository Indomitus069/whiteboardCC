import Link from 'next/link'
import { useState } from 'react'

export default function Home() {
  const [boardId, setBoardId] = useState('')
  const createId = () => {
    const id = Math.random().toString(36).slice(2, 10)
    setBoardId(id)
  }
  return (
    <div style={{ padding: 24 }}>
      <h1>Collaborative Whiteboard</h1>
      <button onClick={createId}>Create Board Id</button>
      <div style={{ marginTop: 12 }}>
        <input value={boardId} onChange={e => setBoardId(e.target.value)} placeholder="board id" />
        <Link href={`/board/${boardId}`} style={{ marginLeft: 8 }}>Go to Board</Link>
      </div>
    </div>
  )
}
