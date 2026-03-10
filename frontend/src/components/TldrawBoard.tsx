import { useEffect, useMemo, useRef, useState } from 'react'
import { Tldraw, TLRecord, TLStore, createTLStore, Editor } from 'tldraw'
import { WSClient } from '../lib/wsClient'
import { useRouter } from 'next/router'

type Operation = {
  operationId: string
  type: 'CREATE_OBJECT' | 'UPDATE_OBJECT' | 'MOVE_OBJECT' | 'DELETE_OBJECT'
  boardId: string
  objectId: string
  delta: Record<string, unknown>
  version: number
  userId: string
  timestamp: number
}

export default function TldrawBoard({ boardId }: { boardId: string }) {
  const store = useMemo(() => createTLStore({}), [])
  const router = useRouter()
  const userId = useMemo(() => Math.random().toString(36).slice(2), [])
  const ws = useRef<WSClient | null>(null)
  const versionMap = useRef<Record<string, number>>({})
  const [ready, setReady] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [bg, setBg] = useState<string>('#ffffff')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isLaserEnabled, setIsLaserEnabled] = useState(false)
  const isDrawingRef = useRef(false)
  const scribbleIdRef = useRef<string | null>(null)
  const remoteLaserScribbles = useRef<Record<string, { scribbleId: string }>>({})
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const pendingTextDeletes = useRef<Record<string, number>>({})

  useEffect(() => {
    if (editor) {
      editor.user.updateUserPreferences({ colorScheme: theme })
      document.documentElement.setAttribute('data-color-mode', theme)
      document.body.style.backgroundColor = theme === 'dark' ? '#1e1e1e' : '#ffffff'
      document.body.style.color = theme === 'dark' ? '#f0f0f0' : '#111111'
    }
  }, [theme, editor])

  useEffect(() => {
    const url = getWsUrl(boardId, userId)
    ws.current = new WSClient(url)
    ws.current.connect()
    ws.current.on(handleMessage)
    setReady(true)
    return () => {
      ws.current?.off(handleMessage)
    }
  }, [boardId])

  function getWsUrl(bid: string, uid: string) {
    if (typeof window === 'undefined') return ''
    const explicit = process.env.NEXT_PUBLIC_WS_URL
    if (explicit && (explicit.startsWith('ws://') || explicit.startsWith('wss://'))) {
      const base = explicit.replace(/\/$/, '')
      return `${base}/ws?boardId=${bid}&userId=${uid}`
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = process.env.NEXT_PUBLIC_WS_HOST || window.location.host || 'localhost:3001'
    return `${protocol}//${host}/ws?boardId=${bid}&userId=${uid}`
  }

  function handleMessage(msg: any) {
    if (msg.type === 'INIT') {
      const st = msg.state as { objects: Record<string, { id: string; version: number; data: any }> }
      const records: TLRecord[] = []
      for (const id of Object.keys(st.objects)) {
        const obj = st.objects[id]
        versionMap.current[id] = obj.version
      }
    } else if (msg.type === 'OP_APPLIED') {
      const op: Operation = msg.payload
      versionMap.current[op.objectId] = op.version
    } else if (msg.type === 'PRESENCE_UPDATE') {
      const presence = msg.payload as { userId: string; laser?: { scribbleId: string; x: number; y: number; z?: number }; laserStop?: { scribbleId: string } }
      if (!editor) return
      const uid = presence.userId
      if (presence.laser) {
        const { scribbleId, x, y } = presence.laser
        if (!remoteLaserScribbles.current[uid]) {
          editor.scribbles.addScribble({ color: 'laser', size: 4, delay: 5000, shrink: 0.02, taper: false }, scribbleId)
          remoteLaserScribbles.current[uid] = { scribbleId }
        }
        const s = remoteLaserScribbles.current[uid]
        editor.scribbles.addPoint(s.scribbleId, x, y)
        const shapeUnder = (editor as any).getShapeAtPoint?.({ x, y })
        if (shapeUnder && (shapeUnder as any).type === 'text') {
          const id = (shapeUnder as any).id
          if (!pendingTextDeletes.current[id]) {
            pendingTextDeletes.current[id] = Date.now()
            setTimeout(() => {
              delete pendingTextDeletes.current[id]
              if (editor) editor.deleteShapes([id])
            }, 800)
          }
        }
      } else if (presence.laserStop) {
        const s = remoteLaserScribbles.current[uid]
        if (s) {
          editor.scribbles.stop(s.scribbleId)
          delete remoteLaserScribbles.current[uid]
        }
      }
    }
  }

  useEffect(() => {
    if (!ready) return
    const unsubs = store.listen(({ changes }) => {
      const now = Date.now()
      for (const record of Object.values(changes.added)) {
        if (isShape(record)) {
          const version = 1
          versionMap.current[record.id] = version
          sendOp({
            operationId: cryptoRandomId(),
            type: 'CREATE_OBJECT',
            boardId,
            objectId: record.id,
            delta: record as unknown as Record<string, unknown>,
            version,
            userId,
            timestamp: now
          })
        }
      }
      for (const update of Object.values(changes.updated)) {
        const [prev, next] = update
        if (isShape(next)) {
          const version = (versionMap.current[next.id] || 0) + 1
          versionMap.current[next.id] = version
          const delta = diffRecord(prev, next)
          sendOp({
            operationId: cryptoRandomId(),
            type: 'UPDATE_OBJECT',
            boardId,
            objectId: next.id,
            delta,
            version,
            userId,
            timestamp: now
          })
        }
      }
      for (const record of Object.values(changes.removed)) {
        if (isShape(record)) {
          const version = (versionMap.current[record.id] || 0) + 1
          versionMap.current[record.id] = version
          sendOp({
            operationId: cryptoRandomId(),
            type: 'DELETE_OBJECT',
            boardId,
            objectId: record.id,
            delta: {},
            version,
            userId,
            timestamp: now
          })
        }
      }
    })
    return () => {
      unsubs()
    }
  }, [ready, store])

  function isShape(r: TLRecord) {
    return 'type' in r && typeof (r as any).type === 'string' && (r as any).type.includes('shape')
  }

  // Laser pointer events are usually ephemeral and might not be stored as standard shapes in some versions,
  // but if they are shapes (e.g. type 'laser'), they will be handled by the generic shape logic above.
  // tldraw's laser is often a "scribble" or transient state, but let's ensure we catch it if it's a shape.

  function diffRecord(a: TLRecord, b: TLRecord) {
    const delta: Record<string, unknown> = {}
    for (const key of Object.keys(b)) {
      const va = (a as any)[key]
      const vb = (b as any)[key]
      if (JSON.stringify(va) !== JSON.stringify(vb)) delta[key] = vb
    }
    return delta
  }

  function cryptoRandomId() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  }

  function sendOp(op: Operation) {
    ws.current?.send({ type: 'OP', payload: op })
  }

  useEffect(() => {
    const el = containerRef.current
    const target = (typeof document !== 'undefined' ? document.querySelector('.tl-container') as HTMLElement : null) || el
    if (!target || !editor) return
    const onMouseDown = (e: MouseEvent) => {
      if (!isLaserEnabled || e.button !== 0) return
      isDrawingRef.current = true
      const scribbleId = cryptoRandomId()
      editor.scribbles.addScribble({ color: 'laser', size: 4, delay: 5000, shrink: 0.02, opacity: 1, taper: false }, scribbleId)
      scribbleIdRef.current = scribbleId
    }
    const onMouseMove = () => {
      if (!isLaserEnabled || !isDrawingRef.current || !scribbleIdRef.current) return
      const p = editor.inputs.currentPagePoint
      editor.scribbles.addPoint(scribbleIdRef.current, p.x, p.y)
      ws.current?.send({
        type: 'PRESENCE',
        payload: {
          laser: {
            scribbleId: scribbleIdRef.current,
            x: p.x,
            y: p.y
          }
        }
      })
      const shapeUnder = (editor as any).getShapeAtPoint?.(p)
      if (shapeUnder && (shapeUnder as any).type === 'text') {
        const id = (shapeUnder as any).id
        if (!pendingTextDeletes.current[id]) {
          pendingTextDeletes.current[id] = Date.now()
          setTimeout(() => {
            delete pendingTextDeletes.current[id]
            if (editor) editor.deleteShapes([id])
          }, 800)
        }
      }
    }
    const stopLaser = () => {
      if (scribbleIdRef.current) {
        editor.scribbles.stop(scribbleIdRef.current)
        ws.current?.send({
          type: 'PRESENCE',
          payload: {
            laserStop: { scribbleId: scribbleIdRef.current }
          }
        })
      }
      isDrawingRef.current = false
      scribbleIdRef.current = null
    }
    const onMouseUp = () => stopLaser()
    const onMouseLeave = () => stopLaser()

    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    target.addEventListener('mouseleave', onMouseLeave)
    const onKeyDown = (ke: KeyboardEvent) => {
      if (ke.key.toLowerCase() === 'l') setIsLaserEnabled(v => !v)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      target.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editor, isLaserEnabled])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100vh', position: 'relative', overflow: 'hidden' }}
    >
      <style jsx global>{`
        /* Force background color on all relevant layers */
        .tl-canvas, .tl-container, .tl-background {
          background-color: ${bg} !important;
        }
        [data-color-mode="dark"] .tl-canvas, [data-color-mode="light"] .tl-canvas {
          background-color: ${bg} !important;
        }

        /* Hide the debug panel if it's annoying */
        .tlui-debug-panel {
            display: none !important;
        }
        /* Hide tldraw help menu; we provide our own */
        .tlui-help-menu {
            display: none !important;
        }
      `}</style>
      <div style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 2000,
        display: 'flex',
        gap: 8
      }}>
        <button
          onClick={() => setIsLaserEnabled(!isLaserEnabled)}
          style={{
            background: isLaserEnabled ? (theme === 'dark' ? '#444' : '#f0f0f0') : (theme === 'dark' ? '#2f2f2f' : '#ffffff'),
            border: `1px solid ${theme === 'dark' ? '#555' : '#ddd'}`,
            borderRadius: 999,
            padding: '6px 12px',
            color: theme === 'dark' ? '#f0f0f0' : '#111',
            cursor: 'pointer'
          }}
          title="Toggle Laser Pencil (or press L)"
        >
          🔦 Laser {isLaserEnabled ? 'On' : 'Off'}
        </button>
        <button
          onClick={() => setIsHelpOpen(true)}
          style={{
            background: theme === 'dark' ? '#2f2f2f' : '#ffffff',
            border: `1px solid ${theme === 'dark' ? '#555' : '#ddd'}`,
            borderRadius: 999,
            padding: '6px 12px',
            color: theme === 'dark' ? '#f0f0f0' : '#111',
            cursor: 'pointer'
          }}
          title="Help"
        >
          ❓ Help
        </button>
      </div>
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        display: 'flex'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: theme === 'dark' ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.9)',
          border: `1px solid ${theme === 'dark' ? '#444' : '#eee'}`,
          borderRadius: 16,
          padding: '8px 12px',
          boxShadow: '0 6px 18px rgba(0,0,0,0.15)'
        }}>
          <span style={{ opacity: 0.7, fontSize: 12 }}>Tools</span>
          <div style={{ width: 1, height: 16, background: theme === 'dark' ? '#444' : '#eee' }} />
          <button
            onClick={() => setIsLaserEnabled(!isLaserEnabled)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: isLaserEnabled ? (theme === 'dark' ? '#444' : '#f0f0f0') : 'transparent',
              border: 'none',
              borderRadius: 12,
              padding: '6px 10px',
              color: theme === 'dark' ? '#f0f0f0' : '#111',
              cursor: 'pointer'
            }}
            title="Laser Pencil (or press L)"
          >
            <span>🔦</span>
            <span style={{ fontSize: 12 }}>{isLaserEnabled ? 'Laser On' : 'Laser Off'}</span>
          </button>
        </div>
      </div>
      {isHelpOpen && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: theme === 'dark' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(2px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000
        }}>
          <div style={{
            width: 'min(720px, 90vw)',
            maxHeight: '80vh',
            overflow: 'auto',
            background: theme === 'dark' ? '#1e1e1e' : '#ffffff',
            border: `1px solid ${theme === 'dark' ? '#444' : '#eee'}`,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            color: theme === 'dark' ? '#f0f0f0' : '#111',
            padding: 20
          }}>
            <h2 style={{ margin: 0, marginBottom: 12 }}>Whiteboard CC Help</h2>
            <p>Laser Pencil: toggle using the top-right button or press L, then hold left mouse to draw. Laser strokes are ephemeral and synced live.</p>
            <p>Theme: open the bottom-left menu to switch light/dark and set canvas background.</p>
            <p>Clear: use the bottom-left menu “Clear Canvas”.</p>
            <h3 style={{ marginTop: 16, marginBottom: 8 }}>API</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>WebSocket: <code>{`ws(s)://<host>/ws?boardId=<id>&userId=<uid>`}</code></li>
              <li>HTTP health: <code>{`GET /health`}</code></li>
              <li>Board check: <code>{`GET /api/board/:boardId`}</code></li>
              <li>Messages:
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Client → Server: <code>{`{ type: 'OP', payload: Operation }`}</code></li>
                  <li>Client → Server: <code>{`{ type: 'PRESENCE', payload: {...} }`}</code></li>
                  <li>Server → Clients: <code>{`{ type: 'INIT', state }`}</code>, <code>{`{ type: 'OP_APPLIED', payload }`}</code>, <code>{`{ type: 'PRESENCE_UPDATE', payload }`}</code></li>
                </ul>
              </li>
            </ul>
            <p>Set <code>NEXT_PUBLIC_WS_HOST</code> to your backend host for deployment. The app auto-selects ws/wss based on page protocol.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => setIsHelpOpen(false)}
                style={{
                  background: theme === 'dark' ? '#2f2f2f' : '#ffffff',
                  border: `1px solid ${theme === 'dark' ? '#555' : '#ddd'}`,
                  borderRadius: 8,
                  padding: '6px 12px',
                  color: theme === 'dark' ? '#f0f0f0' : '#111',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bottom Left Menu Button */}
      <div style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 2000,
      }}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          style={{
            background: theme === 'dark' ? '#2f2f2f' : '#ffffff',
            border: `1px solid ${theme === 'dark' ? '#444' : '#eee'}`,
            borderRadius: 8,
            padding: '8px 12px',
            color: theme === 'dark' ? '#f0f0f0' : '#111',
            cursor: 'pointer',
            boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ width: 16, height: 2, background: 'currentColor' }}></div>
            <div style={{ width: 16, height: 2, background: 'currentColor' }}></div>
            <div style={{ width: 16, height: 2, background: 'currentColor' }}></div>
          </div>
        </button>

        {/* Dropdown Menu */}
        {isMenuOpen && (
          <div style={{
            position: 'absolute',
            bottom: 48,
            left: 0,
            width: 220,
            backgroundColor: theme === 'dark' ? '#2f2f2f' : '#ffffff',
            border: `1px solid ${theme === 'dark' ? '#444' : '#eee'}`,
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            padding: 8,
            color: theme === 'dark' ? '#f0f0f0' : '#111',
            display: 'flex',
            flexDirection: 'column',
            gap: 4
          }}>
            {/* Theme Toggle Section */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 4,
              backgroundColor: theme === 'dark' ? '#3f3f3f' : '#f5f5f5',
            }}>
              <span style={{ fontSize: 14 }}>Theme</span>
              <div style={{ display: 'flex', gap: 4, background: theme === 'dark' ? '#222' : '#e0e0e0', padding: 2, borderRadius: 6 }}>
                <button
                  onClick={() => {
                    setTheme('light')
                    setBg('#ffffff')
                    editor?.focus()
                  }}
                  style={{
                    border: 'none',
                    background: theme === 'light' ? '#fff' : 'transparent',
                    padding: '4px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 14,
                    color: theme === 'dark' ? '#fff' : '#000',
                    boxShadow: theme === 'light' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                  }}
                  title="Light mode"
                >
                  ☀️
                </button>
                <button
                  onClick={() => {
                    setTheme('dark')
                    setBg('#1e1e1e')
                    editor?.focus()
                  }}
                  style={{
                    border: 'none',
                    background: theme === 'dark' ? '#444' : 'transparent',
                    padding: '4px 8px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 14,
                    color: theme === 'dark' ? '#fff' : '#000',
                    boxShadow: theme === 'dark' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none'
                  }}
                  title="Dark mode"
                >
                  🌙
                </button>
              </div>
            </div>

            <div style={{ height: 1, backgroundColor: theme === 'dark' ? '#444' : '#eee', margin: '4px 0' }} />

            {/* Background Color Section */}
            <div style={{ padding: '8px 12px' }}>
              <div style={{ fontSize: 14, marginBottom: 8 }}>Canvas Background</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['#ffffff', '#f8f9fa', '#e9ecef', '#1e1e1e', '#2f2f2f'].map(c => (
                  <button
                    key={c}
                    onClick={() => {
                      setBg(c)
                      editor?.focus()
                    }}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      backgroundColor: c,
                      border: bg === c ? `2px solid ${theme === 'dark' ? '#fff' : '#000'}` : `1px solid ${theme === 'dark' ? '#555' : '#ccc'}`,
                      cursor: 'pointer'
                    }}
                    title={c}
                  />
                ))}
                <div style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  backgroundColor: bg,
                  border: `1px solid ${theme === 'dark' ? '#555' : '#ccc'}`,
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer'
                }}>
                  <input
                    type="color"
                    value={bg}
                    onChange={e => {
                      setBg(e.target.value)
                      editor?.focus()
                    }}
                    style={{
                      position: 'absolute',
                      top: -4,
                      left: -4,
                      width: 32,
                      height: 32,
                      opacity: 0,
                      cursor: 'pointer'
                    }}
                    title="Custom color"
                  />
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    color: theme === 'dark' ? '#fff' : '#000',
                    background: 'rgba(0,0,0,0.1)'
                  }}>+</div>
                </div>
              </div>
            </div>

            <div style={{ height: 1, backgroundColor: theme === 'dark' ? '#444' : '#eee', margin: '4px 0' }} />

            {/* Canvas Actions */}
            <div style={{ padding: '4px' }}>
              <button
                onClick={() => {
                  setIsLaserEnabled(!isLaserEnabled)
                  editor?.focus()
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: isLaserEnabled ? (theme === 'dark' ? '#444' : '#f0f0f0') : 'transparent',
                  border: 'none',
                  color: isLaserEnabled ? (theme === 'dark' ? '#fff' : '#000') : (theme === 'dark' ? '#f0f0f0' : '#111'),
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = theme === 'dark' ? '#444' : '#f0f0f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = isLaserEnabled ? (theme === 'dark' ? '#444' : '#f0f0f0') : 'transparent'}
                title="Toggle Laser Pencil (hold left mouse to draw)"
              >
                🔦 Laser Pencil {isLaserEnabled ? 'On' : 'Off'}
              </button>

              <div style={{ height: 1, backgroundColor: theme === 'dark' ? '#444' : '#eee', margin: '4px 0' }} />
              <button
                onClick={() => {
                  if (confirm('Are you sure you want to clear the canvas?')) {
                    if (editor) {
                      const allShapeIds = Array.from(editor.getCurrentPageShapeIds())
                      if (allShapeIds.length > 0) {
                        editor.deleteShapes(allShapeIds)
                      }
                    }
                  }
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: '#ff4d4d',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = theme === 'dark' ? '#444' : '#f0f0f0'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                🗑️ Clear Canvas
              </button>
            </div>

            <div style={{ height: 1, backgroundColor: theme === 'dark' ? '#444' : '#eee', margin: '4px 0' }} />

            <div style={{ padding: '8px 12px', fontSize: 12, opacity: 0.6, textAlign: 'center' }}>
              Whiteboard CC v0.1.0
            </div>
          </div>
        )}
      </div>
      <div style={{ width: '100%', height: '100%' }}>
        <Tldraw
          store={store}
          onMount={setEditor}
        />
      </div>
    </div>
  )
}
