"use client"

// Add a secondary location (POST /admin/locations) or rename any location, the primary included
// (PUT /admin/locations/{id}). The name is checked first (required, at most 50 characters); LOCATION_INVALID's
// details.fields go next to the field, LOCATION_NAME_TAKEN and LOCATION_LIMIT_REACHED above it, and a 404
// LOCATION_NOT_FOUND closes the dialog and reloads the list.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import {
  LocationError,
  NAME_MAX,
  createLocation,
  invalidFields,
  nameError,
  saveRefusalMessage,
  updateLocation,
  type AdminLocation,
} from "@/lib/locations"

export interface LocationFormDialogProps {
  open: boolean
  // null: adding a new secondary location.
  editing: AdminLocation | null
  onClose: () => void
  onSaved: (location: AdminLocation, created: boolean) => void
  // The location no longer exists (404): the list should reload.
  onGone: (message: string) => void
}

export function LocationFormDialog({ open, editing, onClose, onSaved, onGone }: LocationFormDialogProps) {
  const { authFetch } = useAuth()
  const [name, setName] = useState("")
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [topError, setTopError] = useState<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(editing?.name ?? "")
    setFieldError(null)
    setTopError(null)
    setLimitReached(false)
    setSaving(false)
  }, [open, editing])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    const found = nameError(name)
    setFieldError(found)
    setTopError(null)
    setLimitReached(false)
    if (found) return
    const trimmed = name.trim()
    if (editing && trimmed === editing.name) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const saved = editing ? await updateLocation(authFetch, editing.id, { name: trimmed }) : await createLocation(authFetch, { name: trimmed })
      onSaved(saved, editing === null)
    } catch (err) {
      if (!(err instanceof LocationError)) {
        setTopError("Unable to save the location. Check the connection and try again.")
        return
      }
      if (err.code === "LOCATION_NOT_FOUND") {
        onGone(saveRefusalMessage(err) ?? err.message)
        return
      }
      if (err.code === "LOCATION_INVALID") {
        const fields = invalidFields(err)
        if (fields.name) setFieldError(fields.name)
        const other = Object.entries(fields).filter(([field]) => field !== "name")
        if (other.length > 0 || !fields.name) setTopError(other.map(([, message]) => message).join(" ") || err.message)
        return
      }
      setLimitReached(err.code === "LOCATION_LIMIT_REACHED")
      setTopError(saveRefusalMessage(err) ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{editing ? `Rename ${editing.name}` : "Add a location"}</DialogTitle>
            <DialogDescription>
              {editing
                ? editing.kind === "PRIMARY"
                  ? "The primary location receives every delivery and supplies every issue. Its history keeps the new name."
                  : "Its history (waste, stock takes, requests, movements) shows the new name."
                : "A secondary location requests stock from the primary location. It goes last in the list; move it with the arrows."}
            </DialogDescription>
          </DialogHeader>

          {topError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <p>{topError}</p>
              {limitReached && (
                <p className="mt-1">
                  The maximum is a site setting: <Link href="/site-settings" className="underline">Admin → Settings</Link>, group Stock.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="location-name">Name</Label>
            <Input
              id="location-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setFieldError(null)
              }}
              maxLength={NAME_MAX + 10}
              autoComplete="off"
              disabled={saving}
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "location-name-error" : undefined}
            />
            {fieldError ? (
              <p id="location-name-error" className="text-sm text-destructive">
                {fieldError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">At most {NAME_MAX} characters. No two active locations can share a name.</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save" : "Add location"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
