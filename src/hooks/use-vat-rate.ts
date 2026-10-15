import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"

// GET /admin/settings/vat -> { standardRate: 0.15 } (admins and stock admins).
// null while loading or if unavailable: the preview then shows "—" and the server still computes VAT.
export function useVatRate(): number | null {
  const { authFetch, isAuthenticated } = useAuth()
  const [standardRate, setStandardRate] = useState<number | null>(null)

  useEffect(() => {
    if (!isAuthenticated) return
    let cancelled = false
    authFetch("/admin/settings/vat")
      .then(async (res) => (res.ok ? ((await res.json()) as { standardRate?: unknown }) : null))
      .then((body) => {
        if (!cancelled && body && typeof body.standardRate === "number") setStandardRate(body.standardRate)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [authFetch, isAuthenticated])

  return standardRate
}
