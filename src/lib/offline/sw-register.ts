// O3: registering the POS service worker (public/sw.js, generated per build) and activating its updates.
// Production builds only, so `next dev` is never served from a cache. An update waits and activates only on the
// sign-in screen, with no sale pending (O1) and, from O4, the outbox empty.

import { loadPendingSale } from "@/lib/pending-sale"

export const SW_URL = "/sw.js"
export const UPDATE_PATH = "/pos/login"

export function serviceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator
}

export async function registerPosServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (process.env.NODE_ENV !== "production" || !serviceWorkerSupported()) return null
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" })
  } catch {
    return null
  }
}

// O4 replaces this with the outbox check.
export async function outboxIsEmpty(): Promise<boolean> {
  return true
}

export function canActivateUpdate({ pathname, salePending, outboxEmpty }: { pathname: string | null; salePending: boolean; outboxEmpty: boolean }): boolean {
  return pathname === UPDATE_PATH && !salePending && outboxEmpty
}

// Activates a waiting worker when allowed. Returns true when it asked it to.
export async function activateWaitingUpdate(registration: ServiceWorkerRegistration, pathname: string | null): Promise<boolean> {
  const waiting = registration.waiting
  if (!waiting) return false
  const allowed = canActivateUpdate({ pathname, salePending: loadPendingSale() !== null, outboxEmpty: await outboxIsEmpty() })
  if (!allowed) return false
  waiting.postMessage({ type: "SKIP_WAITING" })
  return true
}
