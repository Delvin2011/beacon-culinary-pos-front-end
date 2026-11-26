// T1-8: the name (and logo) of the customer at this page's address, from GET /public/branding (no sign-in). Nothing
// customer-specific is built into the code. Fetched once per page load (Providers), and remembered on this device so
// the till and its receipts still show it offline or before the call returns. localStorage belongs to the origin, so
// each customer address keeps its own; a fresh address shows NEUTRAL_NAME, never another customer's name.
// Module state, as src/lib/customer-status.ts; read with useCustomerBranding().

import { apiFetch } from "@/lib/api-fetch"
import { BRAND } from "@/lib/brand"

export interface CustomerBranding {
  name: string
  logoUrl: string | null
}

// The product name until one is chosen, and the name while nothing is known about this address.
export const NEUTRAL_NAME = BRAND.productName
export const NEUTRAL_BRANDING: CustomerBranding = { name: NEUTRAL_NAME, logoUrl: null }
export const BRANDING_STORAGE_KEY = "pos.customer-branding"

let current: CustomerBranding | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function parse(value: unknown): CustomerBranding | null {
  if (!value || typeof value !== "object") return null
  const { name, logoUrl } = value as { name?: unknown; logoUrl?: unknown }
  if (typeof name !== "string" || name.trim() === "") return null
  if (logoUrl !== null && logoUrl !== undefined && typeof logoUrl !== "string") return null
  return { name: name.trim(), logoUrl: typeof logoUrl === "string" && logoUrl !== "" ? logoUrl : null }
}

function readRemembered(): CustomerBranding | null {
  try {
    const raw = localStorage.getItem(BRANDING_STORAGE_KEY)
    return raw ? parse(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function getCustomerBranding(): CustomerBranding {
  if (!current) current = (typeof window !== "undefined" && readRemembered()) || NEUTRAL_BRANDING
  return current
}

export function subscribeCustomerBranding(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Once per page load. Any failure (offline, suspended, unavailable, unknown address, a bad body) keeps the remembered
// name, or the neutral one.
export function loadCustomerBranding(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      try {
        const res = await apiFetch("/public/branding", { credentials: "omit" })
        if (!res.ok) return
        const branding = parse(await res.json())
        if (!branding) return
        const before = getCustomerBranding()
        try {
          localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(branding))
        } catch {
          // Storage full or blocked: shown, not remembered.
        }
        if (before.name === branding.name && before.logoUrl === branding.logoUrl) return
        current = branding
        listeners.forEach((listener) => listener())
      } catch {
        // Kept as it is.
      }
    })()
  }
  return loading
}

// For tests: as a fresh page load (the remembered value is read again).
export function resetCustomerBranding(): void {
  current = null
  loading = null
}
