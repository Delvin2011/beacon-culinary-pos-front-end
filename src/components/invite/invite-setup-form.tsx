"use client"

// The invite page's form (T0-6b): a password and/or PIN, each REQUIRED, OPTIONAL (may be left empty) or NONE
// (hidden), each entered twice. The confirmations are checked here; the server's field messages
// (INVITE_CREDENTIALS_INVALID details.fields, PIN_IN_USE) show under their fields.

import { type FormEvent, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { InviteLookup } from "@/lib/invites"
import { PASSWORD_MAX, PASSWORD_MIN, validatePassword, validatePin } from "@/lib/staff"
import { cn } from "@/lib/utils"

export interface InviteCredentialsInput {
  password?: string
  pin?: string
}

interface InviteSetupFormProps {
  lookup: InviteLookup
  submitting: boolean
  // From the server, keyed "password" / "pin".
  serverFields: Record<string, string>
  // Any other refusal, shown above the button.
  formError: string | null
  onSubmit: (credentials: InviteCredentialsInput) => void
}

type Field = "password" | "passwordConfirm" | "pin" | "pinConfirm"

export function InviteSetupForm({ lookup, submitting, serverFields, formError, onSubmit }: InviteSetupFormProps) {
  const showPassword = lookup.password !== "NONE"
  const showPin = lookup.pin !== "NONE"
  const [values, setValues] = useState<Record<Field, string>>({ password: "", passwordConfirm: "", pin: "", pinConfirm: "" })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [server, setServer] = useState<Record<string, string>>(serverFields)

  useEffect(() => setServer(serverFields), [serverFields])

  const update = (field: Field, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    const base = field.startsWith("pin") ? "pin" : "password"
    setServer((prev) => {
      if (!(base in prev)) return prev
      const next = { ...prev }
      delete next[base]
      return next
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    const found: Partial<Record<Field, string>> = {
      ...(showPassword ? validatePassword(values.password, values.passwordConfirm, lookup.password === "REQUIRED") : {}),
      ...(showPin ? validatePin(values.pin, values.pinConfirm, lookup.pin === "REQUIRED") : {}),
    }
    if (showPassword && !values.password && values.passwordConfirm) found.password = "Enter the password in both boxes."
    if (showPin && !values.pin && values.pinConfirm) found.pin = "Enter the PIN in both boxes."
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onSubmit({
      ...(showPassword && values.password ? { password: values.password } : {}),
      ...(showPin && values.pin ? { pin: values.pin } : {}),
    })
  }

  const message = (field: Field) => errors[field] ?? (field === "password" || field === "pin" ? server[field] : undefined)

  const input = (field: Field, label: string, kind: "password" | "pin", autoComplete: string) => {
    const error = message(field)
    const id = `invite-${field}`
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="password"
          value={values[field]}
          onChange={(event) => update(field, kind === "pin" ? event.target.value.replace(/\D/g, "").slice(0, 6) : event.target.value)}
          autoComplete={autoComplete}
          {...(kind === "pin" ? { inputMode: "numeric" as const, maxLength: 6, pattern: "\\d{6}" } : { maxLength: PASSWORD_MAX })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={cn(error && "border-destructive")}
          disabled={submitting}
        />
        {error && (
          <p id={`${id}-error`} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {lookup.email && (
        // Lets a password manager save the new password against the right account.
        <input type="email" name="username" autoComplete="username" value={lookup.email} readOnly hidden />
      )}

      {showPassword && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Password{lookup.password === "OPTIONAL" ? " (optional)" : ""}</legend>
          <p className="text-xs text-muted-foreground">
            {PASSWORD_MIN} to {PASSWORD_MAX} characters.
            {lookup.email ? ` You'll sign in with ${lookup.email}.` : ""}
          </p>
          {input("password", "New password", "password", "new-password")}
          {input("passwordConfirm", "Confirm password", "password", "new-password")}
        </fieldset>
      )}

      {showPin && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">PIN{lookup.pin === "OPTIONAL" ? " (optional)" : ""}</legend>
          <p className="text-xs text-muted-foreground">
            Exactly 6 digits.{lookup.pin === "OPTIONAL" ? " Leave both boxes empty if you don't want a PIN." : ""}
          </p>
          {input("pin", "New PIN", "pin", "off")}
          {input("pinConfirm", "Confirm PIN", "pin", "off")}
        </fieldset>
      )}

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "Saving…" : "Save and finish"}
      </Button>
    </form>
  )
}
