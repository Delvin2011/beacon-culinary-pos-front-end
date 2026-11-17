"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { fetchReceiptSettings, type ReceiptSettings } from "@/lib/receipt-settings"

// One fetch per sign-in, shared by every screen that prints. A new sign-in (a new user object; a token refresh
// keeps the same one) fetches again; signing out drops the cache.
let cache: { user: object; promise: Promise<ReceiptSettings | null> } | null = null

export function resetReceiptSettingsCache(): void {
  cache = null
}

// For printing outside React's render (right after a sale): the settings of this sign-in, waiting for the fetch
// if it's still running. null when nobody has fetched them or the fetch failed.
export function currentReceiptSettings(): Promise<ReceiptSettings | null> {
  return cache ? cache.promise : Promise.resolve(null)
}

// null while loading or when the fetch failed: receipts then print without the header and footer.
export function useReceiptSettings(): ReceiptSettings | null {
  const { user, authFetch } = useAuth()
  const [settings, setSettings] = useState<ReceiptSettings | null>(null)

  useEffect(() => {
    if (!user) {
      cache = null
      setSettings(null)
      return
    }
    if (!cache || cache.user !== user) cache = { user, promise: fetchReceiptSettings(authFetch) }
    let active = true
    void cache.promise.then((value) => {
      if (active) setSettings(value)
    })
    return () => {
      active = false
    }
    // authFetch changes with the token; the settings are per sign-in, so only the user matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  return settings
}
