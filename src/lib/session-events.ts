// Runs just before a POS session's tokens are dropped by a lock or a server-ended session, while the till is still
// on screen, so it can keep the cart (lib/pending-cart). A plain sign-out doesn't run it.

export type SessionEndingKind = "LOCK" | "SESSION_ENDED"

type Listener = (kind: SessionEndingKind) => void

const listeners = new Set<Listener>()

export function onSessionEnding(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifySessionEnding(kind: SessionEndingKind): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(kind)
    } catch {
      // Keeping the cart must never stop the sign-out.
    }
  }
}
