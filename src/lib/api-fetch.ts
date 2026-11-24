// T1-3: every API call goes through here, so every response is seen for what it says about the customer
// (src/lib/customer-status.ts). The address is apiUrl's (/api on this origin, T1-0d).
// While the customer is suspended nothing is sent: a call throws CustomerSuspendedError without a request, except the
// recovery check (`whileSuspended`, src/lib/customer-recovery.ts). The screens' loops wait instead of calling.

import { apiUrl } from "@/lib/api-url"
import { fetchWithTimeout, HEALTH_TIMEOUT_MS, timeoutFor } from "@/lib/net"
import { isCustomerSuspended, markUnknownAddress, noteCustomerAnswer } from "@/lib/customer-status"

export interface ApiFetchInit extends RequestInit {
  // The time limit for the response headers. Default: timeoutFor (15 s; 20 s for POST /orders; 5 s for /health).
  // null: no limit (a plain fetch, as the sign-in and public calls had before).
  timeoutMs?: number | null
  // Sent even while the customer is suspended. Only the /health check that looks for the end of a suspension.
  whileSuspended?: boolean
}

// A call made while the customer is suspended: nothing was sent. Not a connection failure and not a sign-out.
export class CustomerSuspendedError extends Error {
  constructor() {
    super("This service is currently unavailable for this site.")
    this.name = "CustomerSuspendedError"
  }
}

// An empty 404 from another path is confirmed with /health once, then not again for this long.
export const UNKNOWN_ADDRESS_CHECK_GAP_MS = 5_000
let confirming: Promise<void> | null = null
let lastConfirmAt = -Infinity

const isHealthPath = (path: string) => path.split("?")[0] === "/health"

export const HEALTH_INIT: ApiFetchInit = { credentials: "omit", cache: "no-store", timeoutMs: HEALTH_TIMEOUT_MS }

function confirmUnknownAddress(): void {
  if (confirming || Date.now() - lastConfirmAt < UNKNOWN_ADDRESS_CHECK_GAP_MS) return
  lastConfirmAt = Date.now()
  // apiFetch("/health") marks the address unknown itself if it also answers an empty 404.
  confirming = apiFetch("/health", HEALTH_INIT)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      confirming = null
    })
}

// For tests.
export function resetApiFetch(): void {
  confirming = null
  lastConfirmAt = -Infinity
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const { timeoutMs, whileSuspended, ...requestInit } = init
  if (isCustomerSuspended() && !whileSuspended) throw new CustomerSuspendedError()
  const url = apiUrl(path)
  const res =
    timeoutMs === null
      ? await fetch(url, requestInit)
      : await fetchWithTimeout(url, requestInit, timeoutMs ?? timeoutFor(url, requestInit.method))
  const answer = await noteCustomerAnswer(res)
  if (answer === "empty-404") {
    if (isHealthPath(path)) markUnknownAddress()
    else confirmUnknownAddress()
  }
  return res
}
