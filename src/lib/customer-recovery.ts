// T1-3: while the customer is suspended, the only call is one /health check every 60 s (± 15 s at random, so a
// site's tills don't all ask at once), plus "Try again". The suspension ends when /health answers anything but
// CUSTOMER_SUSPENDED from the server: 200, or 503 CUSTOMER_UNAVAILABLE (then it's an outage, O1). No answer at all
// keeps it suspended.

import { apiFetch, HEALTH_INIT } from "@/lib/api-fetch"
import { getCustomerStatus, subscribeCustomerStatus } from "@/lib/customer-status"

export const RECOVERY_CHECK_MS = 60_000
export const RECOVERY_JITTER_MS = 15_000

// 45 to 75 s.
export function recoveryDelay(random: () => number = Math.random): number {
  return RECOVERY_CHECK_MS + Math.round((random() * 2 - 1) * RECOVERY_JITTER_MS)
}

// One /health check, sent even while suspended. Its answer updates the customer's status (api-fetch).
export async function checkCustomerNow(): Promise<void> {
  try {
    await apiFetch("/health", { ...HEALTH_INIT, whileSuspended: true })
  } catch {
    // No answer: still suspended; the next check is already planned.
  }
}

// Plans a check while the customer is suspended, one at a time, and stops when it isn't. Returns the cleanup.
export function startRecoveryChecks(random: () => number = Math.random): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let checking = false
  let stopped = false

  const plan = () => {
    if (stopped || checking || timer !== null || !getCustomerStatus().suspended) return
    timer = setTimeout(async () => {
      timer = null
      checking = true
      await checkCustomerNow()
      checking = false
      plan()
    }, recoveryDelay(random))
  }
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const unsubscribe = subscribeCustomerStatus((status) => (status.suspended ? plan() : cancel()))
  plan()
  return () => {
    stopped = true
    unsubscribe()
    cancel()
  }
}
