"use client"

import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  readStaffError,
  roleDescription,
  roleLabel,
  usesPassword,
  usesPin,
  validateEmail,
  validatePassword,
  validatePin,
  type StaffMember,
  type StaffRoleRule,
} from "@/lib/staff"

interface StaffFormDialogProps {
  open: boolean
  // null = create; a member = edit.
  staff: StaffMember | null
  roles: StaffRoleRule[]
  onOpenChange: (open: boolean) => void
  onSaved: (member: StaffMember, created: boolean) => void
}

interface FormState {
  name: string
  role: string
  email: string
  password: string
  passwordConfirm: string
  pin: string
  pinConfirm: string
}

const EMPTY_FORM: FormState = { name: "", role: "", email: "", password: "", passwordConfirm: "", pin: "", pinConfirm: "" }

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

export function StaffFormDialog({ open, staff, roles, onOpenChange, onSaved }: StaffFormDialogProps) {
  const { authFetch } = useAuth()
  const editing = staff !== null
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [pageError, setPageError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(staff ? { ...EMPTY_FORM, name: staff.name, role: staff.role, email: staff.email ?? "" } : EMPTY_FORM)
    setFieldErrors({})
    setPageError(null)
  }, [open, staff])

  const rule = roles.find((candidate) => candidate.role === form.role)
  const roleUsesPassword = usesPassword(rule)
  const roleUsesPin = usesPin(rule)

  // On edit, a credential is only asked for when the new role needs one the person doesn't have.
  // Promoting to Admin always needs a new PIN so its uniqueness can be checked.
  const promotingToAdmin = editing && form.role === "ADMIN" && staff.role !== "ADMIN"
  const showPasswordFields = roleUsesPassword && (!editing || !staff.hasPassword)
  const passwordRequired = rule?.password === "REQUIRED" && (!editing || !staff.hasPassword)
  const showPinFields = roleUsesPin && (!editing || !staff.hasPin || promotingToAdmin)
  const pinRequired = promotingToAdmin || (rule?.pin === "REQUIRED" && (!editing || !staff.hasPin))
  const roleChanged = editing && form.role !== staff.role
  const losesEmailLogin = roleChanged && !roleUsesPassword && staff.hasPassword
  const losesPin = roleChanged && !roleUsesPin && staff.hasPin

  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }))
    setFieldErrors((current) => {
      const next = { ...current }
      for (const key of Object.keys(patch)) delete next[key]
      return next
    })
  }

  // Clear the values of fields the new role hides, so nothing stale is sent.
  const changeRole = (role: string) => {
    const nextRule = roles.find((candidate) => candidate.role === role)
    setForm((current) => ({
      ...current,
      role,
      email: usesPassword(nextRule) ? current.email : "",
      password: usesPassword(nextRule) ? current.password : "",
      passwordConfirm: usesPassword(nextRule) ? current.passwordConfirm : "",
      pin: usesPin(nextRule) ? current.pin : "",
      pinConfirm: usesPin(nextRule) ? current.pinConfirm : "",
    }))
    setFieldErrors({})
  }

  const save = async () => {
    const errors: Record<string, string> = {}
    if (!form.name.trim()) errors.name = "Name is required."
    if (!rule) errors.role = "Choose a role."
    if (roleUsesPassword) Object.assign(errors, validateEmail(form.email, rule?.password === "REQUIRED"))
    if (showPasswordFields) Object.assign(errors, validatePassword(form.password, form.passwordConfirm, passwordRequired))
    if (showPinFields) Object.assign(errors, validatePin(form.pin, form.pinConfirm, pinRequired))
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    // Send only the fields the role uses.
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      role: form.role,
      ...(roleUsesPassword && form.email.trim() ? { email: form.email.trim().toLowerCase() } : {}),
      ...(showPasswordFields && form.password ? { password: form.password } : {}),
      ...(showPinFields && form.pin ? { pin: form.pin } : {}),
      ...(editing ? { active: staff.active } : {}),
    }

    setSaving(true)
    setPageError(null)
    try {
      const res = await authFetch(editing ? `/admin/staff/${staff.id}` : "/admin/staff", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const apiError = await readStaffError(res, editing ? "Unable to save changes." : "Unable to create this staff member.")
        setFieldErrors(apiError.fieldErrors)
        setPageError(apiError.pageError)
        return
      }
      onSaved((await res.json()) as StaffMember, !editing)
    } catch {
      setPageError("Unable to reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  const credentialHint = (kind: "password" | "PIN") =>
    editing ? `Required now: the ${roleLabel(roles, form.role)} role needs a ${kind} and this person doesn't have one.` : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${staff.name}` : "Add Staff Member"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Change name, role or email. Reset a password or PIN from the staff list."
              : "The credentials needed depend on the role."}
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
            <Label htmlFor="staff-name">Name</Label>
            <Input
              id="staff-name"
              value={form.name}
              onChange={(event) => update({ name: event.target.value })}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? "staff-name-error" : undefined}
              autoComplete="off"
            />
            <FieldError id="staff-name-error" message={fieldErrors.name} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="staff-role">Role</Label>
            <Select value={form.role} onValueChange={changeRole}>
              <SelectTrigger id="staff-role" aria-invalid={!!fieldErrors.role}>
                <SelectValue placeholder="Choose a role…" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((option) => (
                  <SelectItem key={option.role} value={option.role}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError id="staff-role-error" message={fieldErrors.role} />
            {rule && roleDescription(rule.role) && <p className="text-sm">{roleDescription(rule.role)}</p>}
            {rule && (
              <p className="text-xs text-muted-foreground">
                {roleUsesPassword ? "Logs in to the back office with email and password" : "No back-office login"}
                {roleUsesPin ? `; uses a 6-digit PIN${rule.pin === "OPTIONAL" ? " (optional)" : ""} on the tile screens.` : "; no PIN."}
              </p>
            )}
          </div>

          {(losesEmailLogin || losesPin) && (
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {losesEmailLogin && "This removes their email and password; they'll only be able to log in by PIN. "}
                {losesPin && "This removes their PIN; they'll no longer appear on the tile login screens."}
              </p>
            </div>
          )}

          {roleUsesPassword && (
            <div className="space-y-1">
              <Label htmlFor="staff-email">
                Email{rule?.password === "REQUIRED" ? "" : " (optional)"}
              </Label>
              <Input
                id="staff-email"
                type="email"
                value={form.email}
                onChange={(event) => update({ email: event.target.value })}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "staff-email-error" : undefined}
                autoComplete="off"
              />
              <FieldError id="staff-email-error" message={fieldErrors.email} />
            </div>
          )}

          {showPasswordFields && (
            <div className="space-y-3 rounded-md border p-3">
              {passwordRequired && credentialHint("password") && (
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{credentialHint("password")}</p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="staff-password">Password{passwordRequired ? "" : " (optional)"}</Label>
                  <Input
                    id="staff-password"
                    type="password"
                    value={form.password}
                    onChange={(event) => update({ password: event.target.value })}
                    aria-invalid={!!fieldErrors.password}
                    aria-describedby="staff-password-help"
                    autoComplete="new-password"
                  />
                  <p id="staff-password-help" className="text-xs text-muted-foreground">6–25 characters.</p>
                  <FieldError id="staff-password-error" message={fieldErrors.password} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="staff-password-confirm">Confirm password</Label>
                  <Input
                    id="staff-password-confirm"
                    type="password"
                    value={form.passwordConfirm}
                    onChange={(event) => update({ passwordConfirm: event.target.value })}
                    aria-invalid={!!fieldErrors.passwordConfirm}
                    autoComplete="new-password"
                  />
                  <FieldError id="staff-password-confirm-error" message={fieldErrors.passwordConfirm} />
                </div>
              </div>
            </div>
          )}

          {showPinFields && (
            <div className="space-y-3 rounded-md border p-3">
              {promotingToAdmin ? (
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                  Promoting to Admin needs a new PIN. Admin PINs must be unique.
                </p>
              ) : (
                pinRequired && credentialHint("PIN") && (
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300">{credentialHint("PIN")}</p>
                )
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="staff-pin">PIN{pinRequired ? "" : " (optional)"}</Label>
                  <Input
                    id="staff-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.pin}
                    onChange={(event) => update({ pin: event.target.value.replace(/\D/g, "") })}
                    aria-invalid={!!fieldErrors.pin}
                    aria-describedby="staff-pin-help"
                    autoComplete="off"
                  />
                  <p id="staff-pin-help" className="text-xs text-muted-foreground">Exactly 6 digits.</p>
                  <FieldError id="staff-pin-error" message={fieldErrors.pin} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="staff-pin-confirm">Confirm PIN</Label>
                  <Input
                    id="staff-pin-confirm"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.pinConfirm}
                    onChange={(event) => update({ pinConfirm: event.target.value.replace(/\D/g, "") })}
                    aria-invalid={!!fieldErrors.pinConfirm}
                    autoComplete="off"
                  />
                  <FieldError id="staff-pin-confirm-error" message={fieldErrors.pinConfirm} />
                </div>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? (losesEmailLogin ? "Save and remove email login" : "Save Changes") : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
