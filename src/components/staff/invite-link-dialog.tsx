"use client"

// T0-6b: the one-time link, shown once after sending or creating by invite. The QR code is drawn in the browser
// (qrcode.react, bundled: no network request) and only here. Closing the dialog drops the token for good: the parent
// clears its state and this content, the QR code included, unmounts. To share it again, send a new link.

import { useRef, useState } from "react"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { type IssuedInvite, formatInviteExpiry, inviteLink } from "@/lib/invites"

interface InviteLinkDialogProps {
  issued: { invite: IssuedInvite; name: string } | null
  onClose: () => void
}

export function InviteLinkDialog({ issued, onClose }: InviteLinkDialogProps) {
  if (!issued) return null
  return <OpenInviteLinkDialog invite={issued.invite} name={issued.name} onClose={onClose} />
}

function OpenInviteLinkDialog({ invite, name, onClose }: { invite: IssuedInvite; name: string; onClose: () => void }) {
  const link = inviteLink(invite, window.location.origin)
  const inputRef = useRef<HTMLInputElement>(null)
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle")

  const copyLink = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard")
      await navigator.clipboard.writeText(link)
      setCopy("copied")
    } catch {
      inputRef.current?.select()
      setCopy("failed")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Sign-in link for {name}</DialogTitle>
          <DialogDescription>
            This link works once and expires at {formatInviteExpiry(invite.expiresAt)}. Send it privately to the person.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">For example, by WhatsApp or SMS to their own phone.</p>

        <div className="flex gap-2">
          <Input
            ref={inputRef}
            readOnly
            value={link}
            aria-label="Sign-in link"
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={() => void copyLink()}>
            {copy === "copied" ? "Copied" : "Copy"}
          </Button>
        </div>
        {copy === "failed" && <p className="text-sm text-destructive">Couldn&apos;t copy. Select the link and copy it.</p>}

        <div className="flex justify-center rounded-md border bg-white p-4">
          <QRCodeSVG value={link} size={192} role="img" aria-label={`QR code of the sign-in link for ${name}`} />
        </div>

        <p className="text-xs text-muted-foreground">You won&apos;t be able to see this link again after closing. If it&apos;s lost, send a new one.</p>

        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
