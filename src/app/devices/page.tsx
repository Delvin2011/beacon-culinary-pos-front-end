"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { PrintSettingsCard } from "@/components/devices/print-settings-card"
import { ReceiptSettingsDialog } from "@/components/devices/receipt-settings-dialog"
import { toast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { detailString } from "@/lib/api-error"
import {
  DEVICE_TEXT_MAX,
  DeviceApiError,
  DeviceErrorCode,
  REVOKE_REASON_MAX,
  TILL_CODE_MAX,
  TILL_CODE_PATTERN,
  deviceLabel,
  editDevice,
  normaliseTillCode,
  getDeviceConfig,
  listDevices,
  renameCredential,
  revokeCredential,
  revokeDevice,
  type CredentialStatus,
  type Device,
  type DeviceConfig,
  type DeviceCredential,
} from "@/lib/devices"
import { reauthLoginPath } from "@/lib/return-to"
import { TillErrorCode } from "@/lib/till"

const MODE_LABEL: Record<DeviceConfig["mode"], string> = {
  off: "Off (not checked)",
  optional: "Optional (recorded, not enforced)",
  required: "Required (only registered tills)",
}

const BROWSER_STATUS: Record<CredentialStatus, string> = {
  ACTIVE: "Active",
  EXPIRED: "Expired: register this browser again",
  REVOKED: "Revoked",
}

// Local time; "—" when missing or invalid.
function when(iso: string | null | undefined): string {
  if (!iso) return "—"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "—" : format(date, "d MMM yyyy HH:mm")
}

function normaliseSerial(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase()
}

function Marker({ children, tone = "info" }: { children: string; tone?: "info" | "muted" | "danger" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        tone === "info" && "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",
        tone === "muted" && "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200",
        tone === "danger" && "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
      )}
    >
      {children}
    </span>
  )
}

function RevokedLine({ by, at, reason }: { by?: string | null; at: string | null; reason?: string | null }) {
  return (
    <p className="text-xs text-muted-foreground">
      Revoked by {by ?? "—"} on {when(at)}
      {reason ? ` · Reason: ${reason}` : ""}
    </p>
  )
}

type RevokeTarget = { kind: "device"; device: Device } | { kind: "browser"; device: Device; credential: DeviceCredential }
type EditForm = { name: string; serialNumber: string; assetTag: string; tillCode: string }

export default function RegisteredTillsPage() {
  const ready = useDeviceAdminGuard("/devices")
  const router = useRouter()
  const { authFetch } = useAuth()

  const [config, setConfig] = useState<DeviceConfig | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageMessage, setPageMessage] = useState<string | null>(null)

  const [editTarget, setEditTarget] = useState<Device | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ name: "", serialNumber: "", assetTag: "", tillCode: "" })
  const [renameTarget, setRenameTarget] = useState<{ device: Device; credential: DeviceCredential } | null>(null)
  const [renameLabel, setRenameLabel] = useState("")
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null)
  const [receiptSettingsOpen, setReceiptSettingsOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [nextConfig, nextDevices] = await Promise.all([getDeviceConfig(authFetch), listDevices(authFetch)])
      setConfig(nextConfig)
      setDevices(nextDevices)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load the registered tills.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (ready) void load()
  }, [ready, load])

  const closeDialogs = () => {
    setEditTarget(null)
    setRenameTarget(null)
    setRevokeTarget(null)
    setDialogError(null)
    setFieldErrors({})
  }

  const replaceDevice = (updated: Device) => {
    setDevices((current) => current.map((device) => (device.id === updated.id ? updated : device)))
  }

  // Shared handling for edit, rename and revoke failures, by `code`. Conflicts and field errors stay in the dialog;
  // a revoked or vanished till reloads the list; REAUTH_REQUIRED goes to password sign-in and back.
  const handleActionError = (err: unknown, serial?: string, assetTag?: string): void => {
    if (!(err instanceof DeviceApiError)) {
      setDialogError("Unable to reach the server. Try again.")
      return
    }
    const deviceName = detailString(err.details, "deviceName") ?? "another till"
    switch (err.code) {
      case DeviceErrorCode.REAUTH_REQUIRED:
        closeDialogs()
        setPageMessage("Sign in again with your password to manage tills.")
        router.push(reauthLoginPath("/devices"))
        return
      case DeviceErrorCode.REVOKED:
        closeDialogs()
        setPageMessage(`${err.message} The list has been reloaded.`)
        void load()
        return
      case DeviceErrorCode.SERIAL_IN_USE:
        setDialogError(`Serial ${serial ?? ""} is already registered as ${deviceName}.`)
        return
      case DeviceErrorCode.ASSET_TAG_IN_USE:
        setDialogError(`Asset tag ${assetTag ?? ""} is already used by ${deviceName}.`)
        return
      case TillErrorCode.TILL_CODE_IN_USE:
        setDialogError(`Till code ${normaliseTillCode(editForm.tillCode)} is already used by ${deviceName}.`)
        return
      default:
        if (err.status === 404) {
          closeDialogs()
          setPageMessage(`${err.message.replace(" Refresh the list.", "")} The list has been reloaded.`)
          void load()
          return
        }
        if (Object.keys(err.fieldErrors).length > 0) setFieldErrors(err.fieldErrors)
        else setDialogError(err.message)
    }
  }

  const openEdit = (device: Device) => {
    closeDialogs()
    setPageMessage(null)
    setEditForm({
      name: device.name,
      serialNumber: device.serialNumber ?? "",
      assetTag: device.assetTag ?? "",
      tillCode: device.tillCode ?? "",
    })
    setEditTarget(device)
  }

  const saveEdit = async () => {
    if (!editTarget) return
    const errors: Record<string, string> = {}
    if (!editForm.name.trim()) errors.name = "Till name is required."
    if (config?.requireSerial && !normaliseSerial(editForm.serialNumber)) errors.serialNumber = "Serial number is required."
    const tillCode = normaliseTillCode(editForm.tillCode)
    if (tillCode && !TILL_CODE_PATTERN.test(tillCode)) errors.tillCode = "Use 1 to 10 letters, digits or dashes, e.g. T1."
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    setDialogError(null)
    try {
      // A full replace: all three fields, pre-filled from the till.
      const updated = await editDevice(authFetch, editTarget.id, editForm)
      replaceDevice(updated)
      closeDialogs()
      toast({ title: "Till saved", description: `${updated.name} has been updated.` })
    } catch (err) {
      handleActionError(err, normaliseSerial(editForm.serialNumber), editForm.assetTag.trim())
    } finally {
      setSaving(false)
    }
  }

  const openRename = (device: Device, credential: DeviceCredential) => {
    closeDialogs()
    setPageMessage(null)
    setRenameLabel(credential.browserLabel ?? "")
    setRenameTarget({ device, credential })
  }

  const saveRename = async () => {
    if (!renameTarget) return
    if (!renameLabel.trim()) {
      setFieldErrors({ browserLabel: "Browser name is required." })
      return
    }
    setSaving(true)
    setDialogError(null)
    try {
      const updated = await renameCredential(authFetch, renameTarget.device.id, renameTarget.credential.id, renameLabel)
      replaceDevice(updated)
      closeDialogs()
      toast({ title: "Browser renamed" })
    } catch (err) {
      handleActionError(err)
    } finally {
      setSaving(false)
    }
  }

  const openRevoke = (target: RevokeTarget) => {
    closeDialogs()
    setPageMessage(null)
    setReason("")
    setRevokeTarget(target)
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setSaving(true)
    setDialogError(null)
    try {
      const updated =
        revokeTarget.kind === "device"
          ? await revokeDevice(authFetch, revokeTarget.device.id, reason)
          : await revokeCredential(authFetch, revokeTarget.device.id, revokeTarget.credential.id, reason)
      replaceDevice(updated)
      closeDialogs()
      toast({ title: revokeTarget.kind === "device" ? "Till revoked" : "Browser revoked" })
    } catch (err) {
      handleActionError(err)
    } finally {
      setSaving(false)
    }
  }

  if (!ready) return null

  const active = devices.filter((device) => device.status === "ACTIVE")
  const revoked = devices.filter((device) => device.status === "REVOKED")

  const renderDevice = (device: Device) => {
    const isActive = device.status === "ACTIVE"
    const activeBrowsers = device.credentials.filter((credential) => credential.status === "ACTIVE")
    return (
      <li key={device.id} id={`device-${device.id}`} className="space-y-3 rounded-md border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">{deviceLabel(device)}</h2>
              {device.thisDevice && <Marker>This till</Marker>}
              {!isActive && <Marker tone="danger">Revoked</Marker>}
            </div>
            <p className="text-sm text-muted-foreground">
              Serial {device.serialNumber ?? "—"} · Asset tag {device.assetTag ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Registered by {device.registeredBy ?? "—"} on {when(device.registeredAt)}
            </p>
            {!isActive && <RevokedLine by={device.revokedBy} at={device.revokedAt} reason={device.revokeReason} />}
          </div>
          {isActive && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => openEdit(device)}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => openRevoke({ kind: "device", device })}
              >
                Revoke till
              </Button>
            </div>
          )}
        </div>

        {isActive && activeBrowsers.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No active browser. Registering this till&apos;s serial again re-attaches the new browser to it.
          </p>
        )}

        {device.credentials.length > 0 && (
          <ul className="space-y-2">
            {device.credentials.map((credential) => {
              const canChange = isActive && credential.status !== "REVOKED"
              return (
                <li key={credential.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-muted/40 p-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{credential.browserLabel ?? "Browser"}</span>
                      {credential.thisBrowser && <Marker>This browser</Marker>}
                      <Marker tone={credential.status === "ACTIVE" ? "muted" : credential.status === "EXPIRED" ? "warn" : "danger"}>
                        {BROWSER_STATUS[credential.status]}
                      </Marker>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Added by {credential.createdBy ?? "—"} on {when(credential.createdAt)} · Last seen {when(credential.lastSeenAt)}
                      {credential.lastSeenIp ? ` from ${credential.lastSeenIp}` : ""}
                    </p>
                    {credential.status === "REVOKED" && (
                      <RevokedLine by={credential.revokedBy} at={credential.revokedAt} reason={credential.revokeReason} />
                    )}
                  </div>
                  {canChange && (
                    <div className="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openRename(device, credential)}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => openRevoke({ kind: "browser", device, credential })}
                      >
                        Revoke browser
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </li>
    )
  }

  const revokingThis =
    revokeTarget?.kind === "device" ? revokeTarget.device.thisDevice : revokeTarget?.kind === "browser" ? revokeTarget.credential.thisBrowser : false
  const revokingLastBrowser =
    revokeTarget?.kind === "browser" &&
    revokeTarget.credential.status === "ACTIVE" &&
    revokeTarget.device.credentials.filter((credential) => credential.status === "ACTIVE").length === 1

  return (
    <DevicePageShell title="Registered tills">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Registered tills</h1>
          <p className="text-sm text-muted-foreground">POS tills and the browsers registered on them.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setReceiptSettingsOpen(true)}>
            Receipt settings
          </Button>
          <Button asChild size="sm">
            <Link href="/devices/register">Register this till</Link>
          </Button>
        </div>
      </div>

      {config && (
        <dl className="grid gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Mode</dt>
            <dd>{MODE_LABEL[config.mode] ?? config.mode}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Several browsers per till</dt>
            <dd>{config.multiBrowserEnabled ? "Allowed" : "Not allowed"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Serial number</dt>
            <dd>{config.requireSerial ? "Required" : "Optional"}</dd>
          </div>
          {config.maxActiveTills !== undefined && (
            <div>
              <dt className="text-xs text-muted-foreground">Most active tills</dt>
              <dd>{config.maxActiveTills}</dd>
            </div>
          )}
          {config.requireRegistered !== undefined && (
            <div>
              <dt className="text-xs text-muted-foreground">Selling</dt>
              <dd>{config.requireRegistered ? "Registered tills only" : "Any browser"}</dd>
            </div>
          )}
        </dl>
      )}

      {/* O2b: this browser's automatic printing switches, set on each till. */}
      <PrintSettingsCard />

      {pageMessage && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{pageMessage}</p>
          <Button size="sm" variant="ghost" onClick={() => setPageMessage(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : loading && devices.length === 0 ? (
        <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>
      ) : devices.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p>No tills are registered yet.</p>
          <p className="mt-1">
            Open{" "}
            <Link href="/devices/register" className="font-medium underline">
              Register this till
            </Link>{" "}
            on each till, in its own browser.
          </p>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <ul className="space-y-3">{active.map(renderDevice)}</ul>
          ) : (
            <p className="text-sm text-muted-foreground">No active tills.</p>
          )}
          {revoked.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Revoked tills ({revoked.length})</summary>
              <ul className="mt-3 space-y-3">{revoked.map(renderDevice)}</ul>
            </details>
          )}
        </>
      )}

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.name}</DialogTitle>
            <DialogDescription>
              All fields are saved together. A blank asset tag clears it; a blank till code keeps the current one. Shifts already
              opened keep the code they opened with.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveEdit()
            }}
          >
            {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
            {(["tillCode", "name", "serialNumber", "assetTag"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`edit-${key}`}>
                  {key === "tillCode"
                    ? "Till code"
                    : key === "name"
                      ? "Till name"
                      : key === "serialNumber"
                        ? `Serial number${config?.requireSerial ? "" : " (optional)"}`
                        : "Asset tag (optional)"}
                </Label>
                <Input
                  id={`edit-${key}`}
                  value={editForm[key]}
                  maxLength={key === "tillCode" ? TILL_CODE_MAX : DEVICE_TEXT_MAX}
                  aria-invalid={!!fieldErrors[key]}
                  onChange={(event) => {
                    const value = event.target.value
                    setEditForm((current) => ({ ...current, [key]: value }))
                    setFieldErrors({})
                    setDialogError(null)
                  }}
                />
                {fieldErrors[key] && <p className="text-xs text-destructive">{fieldErrors[key]}</p>}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialogs}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename browser</DialogTitle>
            <DialogDescription>A name that helps you recognise this browser on {renameTarget?.device.name}.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void saveRename()
            }}
          >
            {dialogError && <p role="alert" className="text-sm text-destructive">{dialogError}</p>}
            <div className="space-y-1">
              <Label htmlFor="browser-label">Browser name</Label>
              <Input
                id="browser-label"
                value={renameLabel}
                maxLength={DEVICE_TEXT_MAX}
                onChange={(event) => {
                  setRenameLabel(event.target.value)
                  setFieldErrors({})
                  setDialogError(null)
                }}
              />
              {fieldErrors.browserLabel && <p className="text-xs text-destructive">{fieldErrors.browserLabel}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={closeDialogs}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && closeDialogs()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {revokeTarget?.kind === "device"
                ? `Revoke ${revokeTarget.device.name}?`
                : `Revoke ${revokeTarget?.credential.browserLabel ?? "this browser"} on ${revokeTarget?.device.name}?`}
            </DialogTitle>
            <DialogDescription>
              {revokeTarget?.kind === "device"
                ? "The till and all its browsers stop being recognised at once, and everyone signed in on it is signed out. A shift open on it stays open: its owner closes it, or force close it in POS Activity. Its serial number, asset tag and till code become free for a new till."
                : "This browser stops being recognised at once, and anyone signed in on it is signed out."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {revokingThis && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                {revokeTarget?.kind === "device" ? "This is the till you're using." : "This is the browser you're using."} When registration is
                required, this POS stops working for PIN sign-in at once.
              </p>
            )}
            {revokingLastBrowser && (
              <p className="text-muted-foreground">
                It&apos;s this till&apos;s last active browser: the till stays registered with no browsers. Registering its serial again
                re-attaches the new browser to the same till.
              </p>
            )}
            {dialogError && <p role="alert" className="text-destructive">{dialogError}</p>}
            <div className="space-y-1">
              <Label htmlFor="revoke-reason">Reason (optional)</Label>
              <Input
                id="revoke-reason"
                value={reason}
                maxLength={REVOKE_REASON_MAX}
                placeholder="e.g. Replaced"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={closeDialogs}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={saving} onClick={() => void confirmRevoke()}>
              {saving ? "Revoking…" : revokeTarget?.kind === "device" ? "Revoke till" : "Revoke browser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ReceiptSettingsDialog open={receiptSettingsOpen} onClose={() => setReceiptSettingsOpen(false)} />
    </DevicePageShell>
  )
}
