// Auto-print at most once per order id (O2b answer 7): a second retry, or a replay of a sale whose response this till
// did get, prints nothing. Kept in sessionStorage so a reload doesn't print an order twice, tagged with the person
// signed in: someone else's sign-in starts a fresh list, and a lock or a server-ended session clears it.
// "Print receipt again" is still offered for an order that wasn't auto-printed.

export const AUTO_PRINTED_KEY = "pos.autoPrinted"
const MAX_IDS = 50

interface AutoPrinted {
  owner: string
  // Server order ids, or (O4) an offline sale's clientOrderId.
  ids: Array<number | string>
}

function read(): AutoPrinted | null {
  try {
    const raw = sessionStorage.getItem(AUTO_PRINTED_KEY)
    const parsed = raw ? (JSON.parse(raw) as AutoPrinted | null) : null
    return parsed && typeof parsed.owner === "string" && Array.isArray(parsed.ids) ? parsed : null
  } catch {
    return null
  }
}

// Memory copy for when sessionStorage is blocked.
let memory: AutoPrinted | null = null

// true the first time an order id is claimed for this person; false after that.
export function claimAutoPrint(owner: string, orderId: number | string): boolean {
  const current = read() ?? memory
  const ids = current && current.owner === owner ? current.ids : []
  if (ids.includes(orderId)) return false
  const next: AutoPrinted = { owner, ids: [...ids, orderId].slice(-MAX_IDS) }
  memory = next
  try {
    sessionStorage.setItem(AUTO_PRINTED_KEY, JSON.stringify(next))
  } catch {
    // Blocked: the memory copy still guards this page load.
  }
  return true
}

export function clearAutoPrinted(): void {
  memory = null
  try {
    sessionStorage.removeItem(AUTO_PRINTED_KEY)
  } catch {
    // Nothing kept.
  }
}
