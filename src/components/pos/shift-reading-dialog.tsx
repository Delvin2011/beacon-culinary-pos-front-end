"use client"

import { useCallback, useEffect, useState } from "react"
import { Printer, RefreshCw } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { usePrint } from "@/hooks/use-print"
import { ReportStatement } from "@/components/reports/report-statement"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { readApiError } from "@/lib/pos-activity"
import type { PrintMedium, ReportEnvelope } from "@/lib/reports"

// The till's Cashier Reading: GET /shifts/{id}/reading, for the shift's owner or an Admin.
// An open shift's reading is INTERIM (no counted cash or variance yet).
export function ShiftReadingDialog({ shiftId, onClose }: { shiftId: number | null; onClose: () => void }) {
  const { authFetch } = useAuth()
  const { print, portal } = usePrint()
  const [reading, setReading] = useState<ReportEnvelope | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (shiftId === null) return
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch(`/shifts/${shiftId}/reading`)
      if (res.status === 403) throw new Error("Only the shift's cashier or an admin can see this reading.")
      if (res.status === 404) throw new Error("This shift no longer exists.")
      if (!res.ok) throw new Error((await readApiError(res, "Unable to load the reading.")).message)
      setReading((await res.json()) as ReportEnvelope)
    } catch (err) {
      setReading(null)
      setError(err instanceof Error ? err.message : "Unable to load the reading.")
    } finally {
      setLoading(false)
    }
  }, [authFetch, shiftId])

  useEffect(() => {
    if (shiftId === null) return
    setReading(null)
    void load()
  }, [load, shiftId])

  const printReading = (medium: PrintMedium) => {
    if (reading) print(medium, <ReportStatement envelope={reading} medium={medium} />)
  }

  return (
    <>
      <Dialog open={shiftId !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>Shift reading</DialogTitle>
            <DialogDescription>Print the slip for the manager to sign.</DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!reading} onClick={() => printReading("SLIP80")}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print slip
            </Button>
            <Button variant="outline" disabled={!reading} onClick={() => printReading("A4")}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print A4
            </Button>
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Refresh
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !reading ? (
              <p className="animate-pulse py-6 text-sm text-muted-foreground">Loading reading…</p>
            ) : error ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </p>
            ) : reading ? (
              <ReportStatement envelope={reading} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      {portal}
    </>
  )
}
