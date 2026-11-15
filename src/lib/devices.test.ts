import { describe, expect, it, vi } from "vitest"
import {
  DeviceApiError,
  editDevice,
  findThisBrowser,
  getDeviceConfig,
  listDevices,
  registerDevice,
  renameCredential,
  revokeCredential,
  revokeDevice,
  type Device,
} from "@/lib/devices"

const till: Device = {
  id: "d1",
  name: "Till 1",
  type: "POS",
  serialNumber: "PF3X9K2B",
  assetTag: "BC-0042",
  status: "ACTIVE",
  registeredBy: "Canteen Admin",
  registeredAt: "2026-11-13T09:00:00Z",
  revokedAt: null,
  revokeReason: null,
  thisDevice: true,
  credentials: [
    {
      id: "c1",
      browserLabel: "Edge on Windows",
      status: "ACTIVE",
      createdBy: "Canteen Admin",
      createdAt: "2026-11-13T09:00:00Z",
      lastSeenAt: "2026-11-13T09:00:00Z",
      lastSeenIp: "203.0.113.7",
      revokedAt: null,
      thisBrowser: true,
    },
  ],
}

function ok(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))
}

function sent(authFetch: ReturnType<typeof vi.fn>) {
  const [path, init] = authFetch.mock.calls[0] as [string, RequestInit | undefined]
  return { path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

describe("device calls", () => {
  it("reads the config and the list", async () => {
    const config = ok({ mode: "optional", multiBrowserEnabled: false, requireSerial: true })
    expect(await getDeviceConfig(config)).toEqual({ mode: "optional", multiBrowserEnabled: false, requireSerial: true })
    expect(sent(config)).toMatchObject({ path: "/admin/devices/config", method: "GET" })

    const list = ok([till])
    expect(await listDevices(list)).toEqual([till])
    expect(sent(list)).toMatchObject({ path: "/admin/devices", method: "GET" })
  })

  it("registers with trimmed fields, blank optional fields as null, and no joinDeviceId unless given", async () => {
    const authFetch = ok(till, 201)
    await registerDevice(authFetch, { name: "  Till 1 ", serialNumber: " pf3x 9k2b ", assetTag: "  " })
    expect(sent(authFetch)).toEqual({
      path: "/admin/devices",
      method: "POST",
      body: { name: "Till 1", serialNumber: "pf3x 9k2b", assetTag: null },
    })
  })

  it("sends joinDeviceId when joining", async () => {
    const authFetch = ok(till, 201)
    await registerDevice(authFetch, { name: "Till 1", serialNumber: "PF3X9K2B", assetTag: "", joinDeviceId: "d1" })
    expect(sent(authFetch).body).toMatchObject({ joinDeviceId: "d1" })
  })

  it("edits with all three fields (a full replace)", async () => {
    const authFetch = ok(till)
    await editDevice(authFetch, "d1", { name: "Till 1 (front)", serialNumber: "PF3X9K2B", assetTag: "" })
    expect(sent(authFetch)).toEqual({
      path: "/admin/devices/d1",
      method: "PUT",
      body: { name: "Till 1 (front)", serialNumber: "PF3X9K2B", assetTag: null },
    })
  })

  it("renames a browser", async () => {
    const authFetch = ok(till)
    await renameCredential(authFetch, "d1", "c1", " Edge (kiosk) ")
    expect(sent(authFetch)).toEqual({ path: "/admin/devices/d1/credentials/c1", method: "PUT", body: { browserLabel: "Edge (kiosk)" } })
  })

  it("revokes a till or a browser, with the reason only when given", async () => {
    const withReason = ok(till)
    await revokeDevice(withReason, "d1", " Replaced ")
    expect(sent(withReason)).toEqual({ path: "/admin/devices/d1/revoke", method: "POST", body: { reason: "Replaced" } })

    const withoutReason = ok(till)
    await revokeCredential(withoutReason, "d1", "c1", "   ")
    expect(sent(withoutReason)).toEqual({ path: "/admin/devices/d1/credentials/c1/revoke", method: "POST", body: undefined })
  })
})

describe("DeviceApiError", () => {
  it("carries the code, details and the backend's error text", async () => {
    const authFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Already registered.", code: "DEVICE_ALREADY_REGISTERED", details: { deviceName: "Till 1" } }), {
        status: 409,
      }),
    )
    const err = await registerDevice(authFetch, { name: "x", serialNumber: "y", assetTag: "" }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeviceApiError)
    expect(err).toMatchObject({ status: 409, code: "DEVICE_ALREADY_REGISTERED", message: "Already registered.", details: { deviceName: "Till 1" } })
  })

  it("explains an empty 404", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    await expect(revokeDevice(authFetch, "gone")).rejects.toThrow("This till or browser no longer exists. Refresh the list.")
  })

  it("keeps 400 field errors", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ name: "Name is required" }), { status: 400 }))
    const err = (await registerDevice(authFetch, { name: "", serialNumber: "", assetTag: "" }).catch((e: unknown) => e)) as DeviceApiError
    expect(err.fieldErrors).toEqual({ name: "Name is required" })
  })
})

describe("findThisBrowser", () => {
  it("finds the browser marked thisBrowser", () => {
    expect(findThisBrowser([till])).toEqual({ device: till, credential: till.credentials[0] })
  })

  it("returns null when this browser isn't registered", () => {
    const other = { ...till, credentials: [{ ...till.credentials[0], thisBrowser: false }] }
    expect(findThisBrowser([other])).toBeNull()
    expect(findThisBrowser([])).toBeNull()
  })
})
