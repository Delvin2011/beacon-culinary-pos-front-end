"use client"

import { useEffect, useState } from "react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { readStaffError, validatePassword, validatePin, type StaffMember } from "@/lib/staff"

export type CredentialKind = "password" | "pin"

interface CredentialResetDialogProps {
  target: { staff: StaffMember; kind: CredentialKind } | null
  onOpenChange: (open: boolean) => void
  onSaved: (member: StaffMember, kind: CredentialKind) => void
}

// POST /admin/staff/{id}/password or /pin. "Set" when the person has none yet, "Reset" otherwise.
export function CredentialResetDialog({ target, onOpenChange, onSaved }: CredentialResetDialogProps) {
  const { authFetch } = useAuth()
  const [value, setValue] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pageError, setPageError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue("")
    setConfirm("")
    setErrors({})
    setPageError(null)
  }, [target])

  if (!target) return null
  const { staff, kind } = target
  const isPin = kind === "pin"
  const hasIt = isPin ? staff.hasPin : staff.hasPassword
  const verb = hasIt ? "Reset" : "Set"
  const noun = isPin ? "PIN" : "password"
  const fieldKey = isPin ? "pin" : "password"
  const confirmKey = isPin ? "pinConfirm" : "passwordConfirm"

  const save = async () => {
    const validation = isPin ? validatePin(value, confirm, true) : validatePassword(value, confirm, true)
    setErrors(validation)
    if (Object.keys(validation).length > 0) return

    setSaving(true)
    setPageError(null)
    try {
      const res = await authFetch(`/admin/staff/${staff.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [fieldKey]: value }),
      })
      if (!res.ok) {
        const apiError = await readStaffError(res, `Unable to ${verb.toLowerCase()} the ${noun}.`)
        setErrors(apiError.fieldErrors)
        setPageError(apiError.pageError)
        return
      }
      onSaved((await res.json()) as StaffMember, kind)
    } catch {
      setPageError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const sanitise = (raw: string) => (isPin ? raw.replace(/\D/g, "").slice(0, 6) : raw)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {verb} {noun} for {staff.name}
          </DialogTitle>
          <DialogDescription>
            {isPin
              ? "Exactly 6 digits. Admin PINs must be unique; other staff may share a PIN."
              : "6–25 characters. They'll use it with their email to log in to the back office."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {pageError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {pageError}
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="credential-new">New {noun}</Label>
            <Input
              id="credential-new"
              type="password"
              inputMode={isPin ? "numeric" : undefined}
              value={value}
              onChange={(event) => {
                setValue(sanitise(event.target.value))
                setErrors({})
              }}
              aria-invalid={!!errors[fieldKey]}
              autoComplete={isPin ? "off" : "new-password"}
              autoFocus
            />
            {errors[fieldKey] && (
              <p role="alert" className="text-xs text-destructive">
                {errors[fieldKey]}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="credential-confirm">Confirm {noun}</Label>
            <Input
              id="credential-confirm"
              type="password"
              inputMode={isPin ? "numeric" : undefined}
              value={confirm}
              onChange={(event) => {
                setConfirm(sanitise(event.target.value))
                setErrors({})
              }}
              aria-invalid={!!errors[confirmKey]}
              autoComplete={isPin ? "off" : "new-password"}
            />
            {errors[confirmKey] && (
              <p role="alert" className="text-xs text-destructive">
                {errors[confirmKey]}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : `${verb} ${noun}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
