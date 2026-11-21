"use client"

// T0-6b: send someone a sign-in link (POST /admin/staff/{id}/invite). The admin chooses a set-up link (STAFF_SETUP)
// or a reset (RESET); for a role whose PIN is optional (Head Chef) a reset can include the PIN (credentials BOTH).
// REAUTH_REQUIRED (a link for an ADMIN): the choice is kept (no token or password exists yet), the admin signs in
// again with their password, and back here this dialog asks "Send the link to {name} now?" before sending.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { type IssuedInvite, StaffInviteError, issueInvite, offersPinWithReset } from "@/lib/invites"
import { reauthLoginPath } from "@/lib/return-to"
import { type StaffMember, type StaffRoleRule, usesPassword, usesPin } from "@/lib/staff"
import { type SendInviteRequest, saveInviteDraft } from "@/lib/staff-invite-draft"

export interface SendInviteTarget {
  member: StaffMember
  // Restored after the re-sign-in.
  request?: SendInviteRequest
  afterReauth?: boolean
}

interface SendInviteDialogProps {
  target: SendInviteTarget | null
  rule: StaffRoleRule | undefined
  onOpenChange: (open: boolean) => void
  onIssued: (member: StaffMember, invite: IssuedInvite) => void
}

// Set-up when none of the role's credentials is set yet; a reset otherwise.
function defaultPurpose(member: StaffMember, rule: StaffRoleRule | undefined): SendInviteRequest["purpose"] {
  const anySet = (usesPassword(rule) && member.hasPassword) || (usesPin(rule) && member.hasPin)
  return anySet ? "RESET" : "STAFF_SETUP"
}

export function SendInviteDialog({ target, rule, onOpenChange, onIssued }: SendInviteDialogProps) {
  const router = useRouter()
  const { authFetch } = useAuth()
  const [purpose, setPurpose] = useState<SendInviteRequest["purpose"]>("STAFF_SETUP")
  const [alsoResetPin, setAlsoResetPin] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    setPurpose(target.request?.purpose ?? defaultPurpose(target.member, rule))
    setAlsoResetPin(target.request?.alsoResetPin ?? false)
    setError(null)
  }, [target, rule])

  if (!target) return null
  const { member, afterReauth } = target
  const pinChoice = purpose === "RESET" && offersPinWithReset(rule)

  const send = async () => {
    setSending(true)
    setError(null)
    const request: SendInviteRequest = { purpose, alsoResetPin: pinChoice && alsoResetPin }
    try {
      const invite = await issueInvite(authFetch, member.id, request.purpose, request.alsoResetPin)
      onIssued(member, invite)
    } catch (err) {
      if (err instanceof StaffInviteError && err.needsReauth) {
        saveInviteDraft({ kind: "send", staffId: member.id, request })
        router.push(reauthLoginPath("/staff"))
        return
      }
      setError(err instanceof Error ? err.message : "The link couldn't be sent. Try again.")
    } finally {
      setSending(false)
    }
  }

  const option = (value: SendInviteRequest["purpose"], label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-foreground">
      <input
        type="radio"
        name="invite-purpose"
        value={value}
        checked={purpose === value}
        onChange={() => setPurpose(value)}
        disabled={sending}
        aria-labelledby={`invite-purpose-${value}`}
        aria-describedby={`invite-purpose-${value}-hint`}
        className="mt-1"
      />
      <span>
        <span id={`invite-purpose-${value}`} className="block text-sm font-medium">
          {label}
        </span>
        <span id={`invite-purpose-${value}-hint`} className="block text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </label>
  )

  return (
    <Dialog open onOpenChange={(open) => !sending && onOpenChange(open)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{afterReauth ? `Send the link to ${member.name} now?` : `Sign-in link for ${member.name}`}</DialogTitle>
          <DialogDescription>
            They open the link on their own phone and choose their own password or PIN. Any link they already have stops working.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2" aria-label="Link">
          {option("STAFF_SETUP", "Send set-up link", "For someone who hasn't set up their sign-in yet.")}
          {option("RESET", "Reset sign-in by link", "They choose a new password or PIN; the old one stops working once they do.")}
        </fieldset>

        {pinChoice && (
          <div className="flex items-start gap-2">
            <Checkbox id="invite-also-pin" checked={alsoResetPin} onCheckedChange={(value) => setAlsoResetPin(value === true)} disabled={sending} className="mt-0.5" />
            <div>
              <Label htmlFor="invite-also-pin">Also reset the PIN</Label>
              <p className="text-xs text-muted-foreground">Otherwise the link resets the password only.</p>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={sending} onClick={() => void send()}>
            {sending ? "Creating…" : afterReauth ? "Send link" : "Create link"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
