import { useCallback, useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { canViewReports } from "@/lib/roles"
import type { ReportDefinition } from "@/lib/reports"

// GET /admin/reports: only the reports the caller may run.
export function useReportCatalogue() {
  const { authFetch, isAuthenticated, user } = useAuth()
  const canLoad = isAuthenticated && canViewReports(user?.role)
  const [reports, setReports] = useState<ReportDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/admin/reports")
      if (res.status === 403) throw new Error("You don't have permission to view reports.")
      if (!res.ok) throw new Error("Unable to load the report list.")
      const body = (await res.json()) as unknown
      setReports(Array.isArray(body) ? (body as ReportDefinition[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the report list.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (canLoad) void load()
  }, [canLoad, load])

  return { reports, loading, error, reload: load }
}
