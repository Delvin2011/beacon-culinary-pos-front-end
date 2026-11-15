"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DevicePageShell, useDeviceAdminGuard } from "@/components/devices/device-page-shell"
import { detailString } from "@/lib/api-error"
import {
  DEVICE_TEXT_MAX,
  DeviceApiError,
  DeviceErrorCode,
  findThisBrowser,
  getDeviceConfig,
  listDevices,
  registerDevice,
  revokeCredential,
  type Device,
  type DeviceConfig,
} from "@/lib/devices"
import { saveRegisterDraft, takeRegisterDraft, type RegisterDraft } from "@/lib/register-draft"
import { reauthLoginPath } from "@/lib/return-to"

// The server's normalisation (contract section 1): all whitespace removed, upper-cased. Messages show this value.
function normaliseSerial(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase()
}

type Outcome =
  // `unverified`: the list couldn't be reloaded to confirm this browser kept the till cookie.
  | { kind: "registered"; device: Device; joined: boolean; unverified: boolean }
  // Registered on the server, but this browser didn't keep the cookie (private window, blocked cookies).
  | { kind: "cookieMissing"; device: Device; credentialId: string | null }

interface Problem {
  message: string
  link?: { href: string; label: string }
}

const EMPTY_FORM: RegisterDraft = { name: "", serialNumber: "", assetTag: "" }
const REAUTH_MESSAGE = "Sign in again with your password to manage tills."

export default function RegisterTillPage() {
  const ready = useDeviceAdminGuard("/devices/register")
  const router = useRouter()
  const { authFetch, logout } = useAuth()

  const [config, setConfig] = useState<DeviceConfig | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [form, setForm] = useState<RegisterDraft>(EMPTY_FORM)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<Problem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [joinTarget, setJoinTarget] = useState<{ deviceId: string; deviceName: string } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState(false)
  const draftTaken = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [nextConfig, nextDevices] = await Promise.all([getDeviceConfig(authFetch), listDevices(authFetch)])
      setConfig(nextConfig)
      setDevices(nextDevices)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Unable to load the till settings.")
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    if (ready) void load()
  }, [ready, load])

  // Back from a re-sign-in: restore the form once (the draft is deleted as it's read).
  useEffect(() => {
    if (!ready || draftTaken.current) return
    draftTaken.current = true
    const draft = takeRegisterDraft()
    if (draft) setForm(draft)
  }, [ready])

  const updateField = (key: keyof RegisterDraft) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [key]: value }))
    setFieldErrors((current) => {
      const rest = { ...current }
      delete rest[key]
      return rest
    })
    setProblem(null)
  }

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {}
    const name = form.name.trim()
    const serial = normaliseSerial(form.serialNumber)
    if (!name) errors.name = "Till name is required."
    else if (name.length > DEVICE_TEXT_MAX) errors.name = `Till name must be at most ${DEVICE_TEXT_MAX} characters.`
    if (config?.requireSerial && !serial) errors.serialNumber = "Serial number is required."
    else if (serial.length > DEVICE_TEXT_MAX) errors.serialNumber = `Serial number must be at most ${DEVICE_TEXT_MAX} characters.`
    if (form.assetTag.trim().length > DEVICE_TEXT_MAX) errors.assetTag = `Asset tag must be at most ${DEVICE_TEXT_MAX} characters.`
    return errors
  }

  const handleError = (err: unknown) => {
    if (!(err instanceof DeviceApiError)) {
      setProblem({ message: "Unable to reach the server. Try again." })
      return
    }
    const serial = normaliseSerial(form.serialNumber)
    const deviceName = detailString(err.details, "deviceName") ?? "another till"
    const deviceId = detailString(err.details, "deviceId")
    const tillLink = { href: deviceId ? `/devices#device-${deviceId}` : "/devices", label: "Open Registered tills" }

    switch (err.code) {
      case DeviceErrorCode.SERIAL_IN_USE:
        setProblem({
          message: `Serial ${serial} is already registered as ${deviceName}. Revoke its browser (or the till) in Registered tills first.`,
          link: tillLink,
        })
        return
      case DeviceErrorCode.SERIAL_EXISTS:
        if (deviceId) setJoinTarget({ deviceId, deviceName })
        else setProblem({ message: err.message })
        return
      case DeviceErrorCode.JOIN_MISMATCH:
      case DeviceErrorCode.JOIN_DISABLED:
        // The serial or the multi-browser setting changed: start again with fresh settings.
        setJoinTarget(null)
        setProblem({ message: err.message })
        void load()
        return
      case DeviceErrorCode.ASSET_TAG_IN_USE:
        setProblem({ message: `Asset tag ${form.assetTag.trim()} is already used by ${deviceName}.`, link: tillLink })
        return
      case DeviceErrorCode.ALREADY_REGISTERED:
        setProblem({
          message: `This browser is already registered as ${deviceName}. To move it to another till, revoke this browser first.`,
          link: tillLink,
        })
        return
      case DeviceErrorCode.REAUTH_REQUIRED:
        // Keep the three fields (never a password) and come back here after a fresh password sign-in.
        saveRegisterDraft(form)
        setProblem({ message: REAUTH_MESSAGE })
        router.push(reauthLoginPath("/devices/register"))
        return
      default:
        if (Object.keys(err.fieldErrors).length > 0) setFieldErrors(err.fieldErrors)
        else setProblem({ message: err.message })
    }
  }

  const submit = async (joinDeviceId?: string) => {
    if (!config || submitting) return
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    setProblem(null)
    const knownIds = new Set(devices.map((device) => device.id))
    try {
      const device = await registerDevice(authFetch, { ...form, joinDeviceId })
      setJoinTarget(null)

      // Did this browser keep the till cookie? The list marks this browser only when the cookie came with it.
      let after: Device[] | null = null
      try {
        after = await listDevices(authFetch)
      } catch {
        after = null
      }
      if (after) setDevices(after)

      const activeBrowsers = device.credentials.filter((credential) => credential.status === "ACTIVE").length
      const joined = knownIds.has(device.id) || activeBrowsers > 1
      if (after && !findThisBrowser(after)) {
        const credential =
          device.credentials.find((entry) => entry.thisBrowser) ??
          [...device.credentials].filter((entry) => entry.status === "ACTIVE").sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0]
        setOutcome({ kind: "cookieMissing", device, credentialId: credential?.id ?? null })
        return
      }
      setOutcome({ kind: "registered", device, joined, unverified: after === null })
    } catch (err) {
      handleError(err)
    } finally {
      setSubmitting(false)
    }
  }

  const removeRegistration = async () => {
    if (outcome?.kind !== "cookieMissing" || !outcome.credentialId) return
    setRemoving(true)
    try {
      await revokeCredential(authFetch, outcome.device.id, outcome.credentialId, "Browser didn't keep the till cookie")
      setRemoved(true)
    } catch (err) {
      if (err instanceof DeviceApiError && err.code === DeviceErrorCode.REAUTH_REQUIRED) {
        setProblem({ message: `${REAUTH_MESSAGE} The registration can also be revoked later in Registered tills.` })
      } else {
        setProblem({ message: err instanceof Error ? err.message : "Unable to remove the registration." })
      }
    } finally {
      setRemoving(false)
      setConfirmRemove(false)
    }
  }

  const signOutToPos = () => {
    // The till stays registered: sign-out never touches the deviceToken cookie.
    logout()
    router.replace("/pos/login")
  }

  if (!ready) return null

  const registeredHere = findThisBrowser(devices)

  return (
    <DevicePageShell title="Register this till">
      <div>
        <h1 className="text-lg font-semibold">Register this till</h1>
        <p className="text-sm text-muted-foreground">
          This registers <strong>this browser on this machine</strong> as a POS till. Do it on the till itself, in the
          browser cashiers use (the kiosk browser), not on a back-office PC.
        </p>
      </div>

      {problem && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <p>{problem.message}</p>
          {problem.link && (
            <Link href={problem.link.href} className="mt-1 inline-block font-medium underline">
              {problem.link.label}
            </Link>
          )}
        </div>
      )}

      {loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : loading && !config ? (
        <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>
      ) : outcome?.kind === "registered" ? (
        <div className="max-w-xl space-y-4 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="font-medium">
            {outcome.joined
              ? `This browser has been added to ${outcome.device.name}.`
              : `This browser is now registered as ${outcome.device.name}.`}
          </p>
          {outcome.unverified && (
            <p className="text-sm">Couldn&apos;t confirm that this browser kept the till cookie. Check it in Registered tills.</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={signOutToPos}>Sign out and return to the POS</Button>
            <Link href="/devices" className="text-sm font-medium underline">
              Manage tills
            </Link>
          </div>
        </div>
      ) : outcome?.kind === "cookieMissing" ? (
        <div className="max-w-xl space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-medium">
            This browser didn&apos;t keep the till cookie. Use a normal (not private) Chrome or Edge window and allow cookies
            for this site, then register again.
          </p>
          {removed ? (
            <p className="text-sm">The registration has been removed.</p>
          ) : (
            <p className="text-sm">
              The server created a registration for {outcome.device.name} anyway. Remove it so it doesn&apos;t linger.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!removed && outcome.credentialId && (
              <Button variant="outline" onClick={() => setConfirmRemove(true)}>
                Remove this registration
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setOutcome(null)
                setRemoved(false)
                setProblem(null)
              }}
            >
              Back to the form
            </Button>
          </div>
        </div>
      ) : registeredHere ? (
        <div className="max-w-xl space-y-2 rounded-md border bg-muted/40 p-4">
          <p className="font-medium">This browser is registered as {registeredHere.device.name}.</p>
          <Link href="/devices" className="text-sm font-medium underline">
            Open Registered tills
          </Link>
        </div>
      ) : config ? (
        <form
          className="max-w-xl space-y-4"
          noValidate
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault()
            void submit()
          }}
        >
          {config.mode !== "required" && (
            <p className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
              Registration isn&apos;t enforced yet; you can register tills in advance.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="till-name">Till name</Label>
            <Input
              id="till-name"
              value={form.name}
              onChange={updateField("name")}
              maxLength={DEVICE_TEXT_MAX}
              placeholder="e.g. Till 1"
              aria-invalid={!!fieldErrors.name}
              autoFocus
            />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="till-serial">Serial number{config.requireSerial ? "" : " (optional)"}</Label>
            <Input
              id="till-serial"
              value={form.serialNumber}
              onChange={updateField("serialNumber")}
              maxLength={DEVICE_TEXT_MAX}
              aria-invalid={!!fieldErrors.serialNumber}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              On the label on the bottom or back of the machine, or in Windows under Settings › System › About (or
              run <code>wmic bios get serialnumber</code>). Spaces are removed and letters capitalised.
            </p>
            {fieldErrors.serialNumber && <p className="text-xs text-destructive">{fieldErrors.serialNumber}</p>}
          </div>

          <div className="space-y-1">
            <Label htmlFor="till-asset-tag">Asset tag (optional)</Label>
            <Input
              id="till-asset-tag"
              value={form.assetTag}
              onChange={updateField("assetTag")}
              maxLength={DEVICE_TEXT_MAX}
              aria-invalid={!!fieldErrors.assetTag}
              autoComplete="off"
            />
            {fieldErrors.assetTag && <p className="text-xs text-destructive">{fieldErrors.assetTag}</p>}
          </div>

          <Button type="submit" disabled={submitting}>
            {submitting ? "Registering…" : "Register this till"}
          </Button>
        </form>
      ) : null}

      <Dialog open={joinTarget !== null} onOpenChange={(open) => !open && setJoinTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add this browser to {joinTarget?.deviceName}?</DialogTitle>
            <DialogDescription>
              Serial {normaliseSerial(form.serialNumber)} is already registered as {joinTarget?.deviceName}. Add this
              browser to it?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setJoinTarget(null)}>
              Cancel
            </Button>
            <Button disabled={submitting} onClick={() => joinTarget && void submit(joinTarget.deviceId)}>
              {submitting ? "Adding…" : "Add this browser"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove this registration?</DialogTitle>
            <DialogDescription>
              This revokes the browser registration the server just created for{" "}
              {outcome?.kind === "cookieMissing" ? outcome.device.name : "this till"}. You can register again afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={removing} onClick={() => void removeRegistration()}>
              {removing ? "Removing…" : "Remove"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DevicePageShell>
  )
}
