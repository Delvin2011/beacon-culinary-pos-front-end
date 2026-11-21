"use client"

// Deactivate or activate a location (POST /admin/locations/{id}/deactivate | activate), after a confirmation.
// A deactivate refusal lists every reason in the dialog; activate can be refused by LOCATION_NAME_TAKEN or
// LOCATION_LIMIT_REACHED. A 404 LOCATION_NOT_FOUND closes the dialog and reloads the list.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAuth } from "@/hooks/use-auth"
import {
  LocationError,
  activateLocation,
  deactivateLocation,
  deactivateRefusal,
  saveRefusalMessage,
  type AdminLocation,
  type DeactivateRefusalItem,
} from "@/lib/locations"
import { DeactivateRefused } from "./deactivate-refused"

export interface LocationStatusDialogProps {
  location: AdminLocation | null
  onClose: () => void
  onDone: (location: AdminLocation) => void
  onGone: (message: string) => void
}

export function LocationStatusDialog({ location, onClose, onDone, onGone }: LocationStatusDialogProps) {
  const { authFetch } = useAuth()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<DeactivateRefusalItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)

  useEffect(() => {
    setBusy(false)
    setRefused(null)
    setError(null)
    setLimitReached(false)
  }, [location])

  if (!location) return null
  const deactivating = location.active

  const confirm = async () => {
    setBusy(true)
    setRefused(null)
    setError(null)
    setLimitReached(false)
    try {
      onDone(deactivating ? await deactivateLocation(authFetch, location.id) : await activateLocation(authFetch, location.id))
    } catch (err) {
      if (!(err instanceof LocationError)) {
        setError("Unable to reach the server. Check the connection and try again.")
        return
      }
      if (err.code === "LOCATION_NOT_FOUND") {
        onGone(saveRefusalMessage(err) ?? err.message)
        return
      }
      const reasons = deactivateRefusal(err)
      if (reasons) {
        setRefused(reasons)
        return
      }
      setLimitReached(err.code === "LOCATION_LIMIT_REACHED")
      setError(saveRefusalMessage(err) ?? err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{deactivating ? `Deactivate ${location.name}?` : `Activate ${location.name}?`}</DialogTitle>
          <DialogDescription>
            {deactivating
              ? "It disappears from the location pickers. Its history (waste, stock takes, requests, movements) keeps its name."
              : "It comes back in the location pickers."}
          </DialogDescription>
        </DialogHeader>

        {refused && <DeactivateRefused locationName={location.name} items={refused} />}
        {error && (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p>{error}</p>
            {limitReached && (
              <p className="mt-1">
                The maximum is a site setting: <Link href="/site-settings" className="underline">Admin → Settings</Link>, group Stock.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {refused ? "Close" : "Cancel"}
          </Button>
          {!refused && (
            <Button type="button" variant={deactivating ? "destructive" : "default"} onClick={() => void confirm()} disabled={busy}>
              {busy ? "Working…" : deactivating ? "Deactivate" : "Activate"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
