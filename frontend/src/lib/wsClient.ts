type Listener = (msg: any) => void

export class WSClient {
  private ws: WebSocket | null = null
  private listeners: Set<Listener> = new Set()
  private url: string
  private reconnectAttempts = 0
  private isClosedManually = false
  private heartbeatTimer: any = null
  private lastPongAt = 0

  constructor(url: string) {
    this.url = url
  }

  connect() {
    this.isClosedManually = false
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.startHeartbeat()
    }
    this.ws.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data as string)
        if (data && data.type === 'PONG') {
          this.lastPongAt = Date.now()
          return
        }
        for (const l of this.listeners) l(data)
      } catch {}
    }
    this.ws.onclose = () => {
      this.stopHeartbeat()
      if (this.isClosedManually) return
      const timeout = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000)
      this.reconnectAttempts += 1
      setTimeout(() => this.connect(), timeout)
    }
    this.ws.onerror = () => {
      try { this.ws?.close() } catch {}
    }
  }

  on(listener: Listener) {
    this.listeners.add(listener)
  }

  off(listener: Listener) {
    this.listeners.delete(listener)
  }

  send(message: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(message))
  }

  close() {
    this.isClosedManually = true
    try { this.ws?.close() } catch {}
    this.ws = null
    this.stopHeartbeat()
  }

  private startHeartbeat() {
    this.stopHeartbeat()
    this.lastPongAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
      try {
        this.ws.send(JSON.stringify({ type: 'PING', t: Date.now() }))
      } catch {}
      const now = Date.now()
      if (now - this.lastPongAt > 15000) {
        try { this.ws?.close() } catch {}
      }
    }, 10000)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
