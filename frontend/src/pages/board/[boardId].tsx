import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'

const TldrawBoard = dynamic(() => import('../../components/TldrawBoard'), { ssr: false })

export default function BoardPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const { boardId } = router.query

  useEffect(() => {
    if (!router.isReady) return
    if (!boardId || typeof boardId !== 'string') return

    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https:' : 'http:'
    const host = process.env.NEXT_PUBLIC_WS_HOST || (typeof window !== 'undefined' ? window.location.host : '') || 'localhost:3001'
    fetch(`${protocol}//${host}/api/board/${boardId}`)
      .then(res => res.json())
      .then(data => {
        if (!data.exists) {
          setError('Board does not exist')
        }
      })
      .catch(() => {})
  }, [boardId, router.isReady])

  if (!router.isReady) {
    return <div style={{ padding: 24 }}>Loading board…</div>
  }

  if (!boardId || typeof boardId !== 'string') {
    return <div style={{ padding: 24 }}>Invalid board id</div>
  }

  if (error) {
    return <div style={{ padding: 24 }}>Board not found. Please create a new one.</div>
  }
  
  return <TldrawBoard boardId={boardId} />
}
