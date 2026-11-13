// POS till registration (WS1-1b): types and calls for /admin/devices (contract
// docs/2026-11-13-device-registration-api-contract.md, section 6). Every call needs an ADMIN session; register,
// edit, rename and revoke also need a password sign-in within 30 minutes (403 REAUTH_REQUIRED otherwise).

import { readApiError, type ApiError } from "@/lib/api-error"

type AuthFetch = (path: string, init?: RequestInit) => Promise<Response>

export type DeviceTrustMode = "off" | "optional" | "required"

export interface DeviceConfig {
  mode: DeviceTrustMode
  multiBrowserEnabled: boolean
  requireSerial: boolean
}

export type DeviceStatus = "ACTIVE" | "REVOKED"
// EXPIRED: unused for the idle-expiry period; its cookie no longer works.
export type CredentialStatus = "ACTIVE" | "EXPIRED" | "REVOKED"

// One browser on a till. Timestamps are UTC ISO-8601.
export interface DeviceCredential {
  id: string
  browserLabel: string | null
  status: CredentialStatus
  createdBy: string | null
  createdAt: string | null
  lastSeenAt: string | null
  lastSeenIp: string | null
  revokedAt: string | null
  revokedBy?: string | null
  revokeReason?: string | null
  thisBrowser: boolean
}

// One till (machine), identified by its normalised serial number.
export interface Device {
  id: string
  name: string
  type: string
  serialNumber: string | null
  assetTag: string | null
  status: DeviceStatus
  registeredBy: string | null
  registeredAt: string | null
  revokedAt: string | null
  revokedBy?: string | null
  revokeReason: string | null
  thisDevice: boolean
  credentials: DeviceCredential[]
}

export const DeviceErrorCode = {
  NOT_REGISTERED: "DEVICE_NOT_REGISTERED",
  REAUTH_REQUIRED: "REAUTH_REQUIRED",
  SERIAL_IN_USE: "DEVICE_SERIAL_IN_USE",
  SERIAL_EXISTS: "DEVICE_SERIAL_EXISTS",
  JOIN_MISMATCH: "DEVICE_JOIN_MISMATCH",
  JOIN_DISABLED: "DEVICE_JOIN_DISABLED",
  ASSET_TAG_IN_USE: "DEVICE_ASSET_TAG_IN_USE",
  ALREADY_REGISTERED: "DEVICE_ALREADY_REGISTERED",
  REVOKED: "DEVICE_REVOKED",
} as const

export const TILL_NOT_REGISTERED_MESSAGE = "This till is not registered. Ask a manager to register it."
export const DEVICE_TEXT_MAX = 100
export const REVOKE_REASON_MAX = 255

// A failed /admin/devices call. `message` is the backend's `error` text, or a plain fallback.
export class DeviceApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly details: Record<string, unknown> | null
  readonly fieldErrors: Record<string, string>

  constructor(apiError: ApiError, fallback: string) {
    super(apiError.error ?? (apiError.status === 404 ? "This till or browser no longer exists. Refresh the list." : fallback))
    this.status = apiError.status
    this.code = apiError.code
    this.details = apiError.details
    this.fieldErrors = apiError.fieldErrors
  }
}

async function call<T>(authFetch: AuthFetch, path: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await authFetch(path, init)
  if (!res.ok) throw new DeviceApiError(await readApiError(res), fallback)
  return (await res.json()) as T
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

// Blank optional text is sent as null.
function optional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  return trimmed ? trimmed : null
}

export function getDeviceConfig(authFetch: AuthFetch): Promise<DeviceConfig> {
  return call(authFetch, "/admin/devices/config", undefined, "Unable to load the till settings.")
}

export function listDevices(authFetch: AuthFetch): Promise<Device[]> {
  return call(authFetch, "/admin/devices", undefined, "Unable to load the registered tills.")
}

export interface RegisterDeviceInput {
  name: string
  serialNumber: string
  assetTag: string
  joinDeviceId?: string | null
}

// Registers the browser making the request (the server sets its deviceToken cookie). 201 with the till.
export function registerDevice(authFetch: AuthFetch, input: RegisterDeviceInput): Promise<Device> {
  const body: Record<string, unknown> = {
    name: input.name.trim(),
    serialNumber: optional(input.serialNumber),
    assetTag: optional(input.assetTag),
  }
  if (input.joinDeviceId) body.joinDeviceId = input.joinDeviceId
  return call(authFetch, "/admin/devices", jsonBody("POST", body), "Unable to register this till.")
}

export interface EditDeviceInput {
  name: string
  serialNumber: string
  assetTag: string
}

// A full replace: all three fields are always sent; a blank asset tag clears it.
export function editDevice(authFetch: AuthFetch, id: string, input: EditDeviceInput): Promise<Device> {
  return call(
    authFetch,
    `/admin/devices/${encodeURIComponent(id)}`,
    jsonBody("PUT", { name: input.name.trim(), serialNumber: optional(input.serialNumber), assetTag: optional(input.assetTag) }),
    "Unable to save the till.",
  )
}

export function renameCredential(authFetch: AuthFetch, id: string, credentialId: string, browserLabel: string): Promise<Device> {
  return call(
    authFetch,
    `/admin/devices/${encodeURIComponent(id)}/credentials/${encodeURIComponent(credentialId)}`,
    jsonBody("PUT", { browserLabel: browserLabel.trim() }),
    "Unable to rename the browser.",
  )
}

// Revokes the till and all its browsers. Revoking an already revoked till changes nothing.
export function revokeDevice(authFetch: AuthFetch, id: string, reason?: string): Promise<Device> {
  const text = optional(reason)
  return call(
    authFetch,
    `/admin/devices/${encodeURIComponent(id)}/revoke`,
    text ? jsonBody("POST", { reason: text }) : { method: "POST" },
    "Unable to revoke the till.",
  )
}

// Revokes one browser. If it was the till's last active browser, the till stays registered with none.
export function revokeCredential(authFetch: AuthFetch, id: string, credentialId: string, reason?: string): Promise<Device> {
  const text = optional(reason)
  return call(
    authFetch,
    `/admin/devices/${encodeURIComponent(id)}/credentials/${encodeURIComponent(credentialId)}/revoke`,
    text ? jsonBody("POST", { reason: text }) : { method: "POST" },
    "Unable to revoke the browser.",
  )
}

// The browser making the request, if it is registered: from GET /admin/devices.
export function findThisBrowser(devices: Device[]): { device: Device; credential: DeviceCredential } | null {
  for (const device of devices) {
    const credential = device.credentials.find((entry) => entry.thisBrowser)
    if (credential) return { device, credential }
  }
  return null
}
