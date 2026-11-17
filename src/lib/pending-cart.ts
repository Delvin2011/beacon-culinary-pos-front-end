// The cart kept when the till is locked or the server ends the session (O2). It comes back only for the same
// person; anyone else is asked whether to keep it for them or discard it. Never sent anywhere.

export const PENDING_CART_KEY = "pos.pendingCart"

export interface PendingCart<Line = unknown> {
  owner: { key: string; name: string | null }
  savedAt: string
  lines: Line[]
}

export function loadPendingCart<Line = unknown>(): PendingCart<Line> | null {
  try {
    const raw = localStorage.getItem(PENDING_CART_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingCart<Line> | null
    if (!parsed || typeof parsed.owner?.key !== "string" || !Array.isArray(parsed.lines) || parsed.lines.length === 0) return null
    return parsed
  } catch {
    return null
  }
}

// An empty cart clears what was kept.
export function savePendingCart<Line>(owner: { key: string; name: string | null }, lines: Line[]): void {
  try {
    if (lines.length === 0) {
      localStorage.removeItem(PENDING_CART_KEY)
      return
    }
    const cart: PendingCart<Line> = { owner, savedAt: new Date().toISOString(), lines }
    localStorage.setItem(PENDING_CART_KEY, JSON.stringify(cart))
  } catch {
    // Storage full or blocked: the cart is lost, the lock still happens.
  }
}

export function clearPendingCart(): void {
  try {
    localStorage.removeItem(PENDING_CART_KEY)
  } catch {
    // Nothing to clear.
  }
}
