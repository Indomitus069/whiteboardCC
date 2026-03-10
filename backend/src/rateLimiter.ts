export class RateLimiter {
  private maxOpsPerMinute: number
  private windows: Map<string, { count: number; windowStart: number }> = new Map()

  constructor(maxOpsPerMinute: number) {
    this.maxOpsPerMinute = maxOpsPerMinute
  }

  allow(key: string): boolean {
    const now = Date.now()
    const win = this.windows.get(key)
    if (!win || now - win.windowStart > 60_000) {
      this.windows.set(key, { count: 1, windowStart: now })
      return true
    }
    if (win.count >= this.maxOpsPerMinute) return false
    win.count += 1
    return true
  }
}
