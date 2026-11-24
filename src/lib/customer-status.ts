// T1-3: the backend works out the customer from the address. Three answers are about the customer, not one request:
//  - 503 ErrorDto { code: "CUSTOMER_SUSPENDED" }: suspended by the vendor, on every API path (/health and /public/*
//    included). Every screen shows a full-page message; nothing goes offline.
//  - 503 ErrorDto { code: "CUSTOMER_UNAVAILABLE" }: temporarily unavailable (e.g. its database is being updated). An
//    outage, as before (O1).
//  - 404 with an empty body, on every path (/health included), at an address no customer has. The backend also
//    answers an empty 404 for a missing record, so an empty 404 means "unknown address" only when /health answers the
//    same (src/lib/api-fetch.ts asks).
// What the browser knows about its customer, for every screen. No React here (src/contexts/customer-status-context.tsx).

export const CUSTOMER_SUSPENDED = "CUSTOMER_SUSPENDED"
export const CUSTOMER_UNAVAILABLE = "CUSTOMER_UNAVAILABLE"

export const SUSPENDED_MESSAGE = "This service is currently unavailable for this site. Please contact your administrator."
export const UNKNOWN_ADDRESS_MESSAGE = "This address isn't set up."

// What one response says about the customer. "ok": any 2xx. "other": anything that says nothing about it.
export type CustomerAnswer = "ok" | "suspended" | "unavailable" | "empty-404" | "other"

export interface CustomerStatus {
  suspended: boolean
  unavailable: boolean
  unknownAddress: boolean
}

export const ACTIVE_CUSTOMER: CustomerStatus = { suspended: false, unavailable: false, unknownAddress: false }

let status: CustomerStatus = ACTIVE_CUSTOMER
const listeners = new Set<(status: CustomerStatus) => void>()
const answers = new WeakMap<Response, CustomerAnswer>()

export function getCustomerStatus(): CustomerStatus {
  return status
}

export function isCustomerSuspended(): boolean {
  return status.suspended
}

export function subscribeCustomerStatus(listener: (status: CustomerStatus) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function update(next: Partial<CustomerStatus>) {
  const merged = { ...status, ...next }
  if (merged.suspended === status.suspended && merged.unavailable === status.unavailable && merged.unknownAddress === status.unknownAddress) return
  status = merged
  listeners.forEach((listener) => listener(status))
}

// For tests: back to an active customer.
export function resetCustomerStatus(): void {
  update(ACTIVE_CUSTOMER)
}

// Resolves at once if the customer isn't suspended, otherwise once it is active again. For loops that would
// otherwise retry against a suspended customer (sale retries, streams): they wait here instead.
export function whenNotSuspended(): Promise<void> {
  if (!status.suspended) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = subscribeCustomerStatus((next) => {
      if (next.suspended) return
      unsubscribe()
      resolve()
    })
  })
}

async function readCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as unknown
    return body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : null
  } catch {
    return null
  }
}

async function hasEmptyBody(res: Response): Promise<boolean> {
  try {
    return (await res.clone().text()).trim() === ""
  } catch {
    return false
  }
}

// Reads a copy of the body, and only for a 503 or a 404, so the caller can still read it.
export async function classifyCustomerAnswer(res: Response): Promise<CustomerAnswer> {
  if (res.status >= 200 && res.status < 300) return "ok"
  if (res.status === 503) {
    const code = await readCode(res)
    if (code === CUSTOMER_SUSPENDED) return "suspended"
    if (code === CUSTOMER_UNAVAILABLE) return "unavailable"
    return "other"
  }
  if (res.status === 404) return (await hasEmptyBody(res)) ? "empty-404" : "other"
  return "other"
}

// What a response already seen by noteCustomerAnswer said; null for one it never saw.
export function customerAnswerOf(res: Response): CustomerAnswer | null {
  return answers.get(res) ?? null
}

// Records what a response says about the customer. An empty 404 changes nothing here: the caller confirms it with
// /health (markUnknownAddress).
export async function noteCustomerAnswer(res: Response): Promise<CustomerAnswer> {
  const answer = await classifyCustomerAnswer(res)
  answers.set(res, answer)
  if (answer === "ok") update(ACTIVE_CUSTOMER)
  else if (answer === "suspended") update({ suspended: true, unavailable: false })
  else if (answer === "unavailable") update({ suspended: false, unavailable: true })
  return answer
}

// /health answered 404 with an empty body: no customer has this address. That also ends a suspension: the screen
// shows "This address isn't set up." instead of the suspended message.
export function markUnknownAddress(): void {
  update({ unknownAddress: true, suspended: false })
}
