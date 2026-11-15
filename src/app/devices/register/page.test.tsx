import type { ReactNode } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import RegisterTillPage from "@/app/devices/register/page"
import type { Device, DeviceConfig } from "@/lib/devices"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function till(overrides: Partial<Device> = {}, thisBrowser = false): Device {
  return {
    id: "d1",
    name: "Till 1",
    type: "POS",
    serialNumber: "PF3X9K2B",
    assetTag: null,
    status: "ACTIVE",
    registeredBy: "Canteen Admin",
    registeredAt: "2026-11-13T09:00:00Z",
    revokedAt: null,
    revokeReason: null,
    thisDevice: thisBrowser,
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
        thisBrowser,
      },
    ],
    ...overrides,
  }
}

// Server state for one test.
let config: DeviceConfig
let lists: Device[][]
let registerResponses: Array<() => Response>
let revokeResponse: () => Response

const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(path) && (init?.method ?? "GET") === method)
const bodyOf = (method: string, path: string, index = 0) => JSON.parse(String(calls(method, path)[index]?.[1]?.body))

function renderAs(role: string) {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "admin@x.co", role } }))
  render(
    <AuthProvider>
      <RegisterTillPage />
    </AuthProvider>,
  )
}

async function fill(label: RegExp, value: string) {
  fireEvent.change(await screen.findByLabelText(label), { target: { value } })
}

async function clickButton(name: string | RegExp, container: HTMLElement = document.body) {
  const button = within(container).getByRole("button", { name })
  await act(async () => {
    fireEvent.click(button)
  })
}

async function registerWith(name: string, serial: string, assetTag = "") {
  await fill(/Till name/, name)
  await fill(/Serial number/, serial)
  await fill(/Asset tag/, assetTag)
  await clickButton("Register this till")
}

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  config = { mode: "optional", multiBrowserEnabled: false, requireSerial: true }
  lists = [[]]
  registerResponses = []
  revokeResponse = () => json(200, till())
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.endsWith("/admin/devices/config")) return json(200, config)
    if (url.endsWith("/admin/devices") && method === "GET") return json(200, lists.length > 1 ? lists.shift() : lists[0])
    if (url.endsWith("/admin/devices") && method === "POST") return (registerResponses.shift() ?? (() => json(500, undefined)))()
    if (url.includes("/revoke")) return revokeResponse()
    if (url.endsWith("/auth/logout")) return new Response(null, { status: 204 })
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Register this till: access and settings", () => {
  it("is admin only", async () => {
    renderAs("CASHIER")
    await act(async () => {})
    expect(replace).toHaveBeenCalledWith("/pos/login")
    expect(calls("GET", "/admin/devices/config")).toHaveLength(0)
    expect(screen.queryByText("Register this till")).not.toBeInTheDocument()
  })

  it("sends a signed-out visitor to password sign-in and back", async () => {
    render(
      <AuthProvider>
        <RegisterTillPage />
      </AuthProvider>,
    )
    await act(async () => {})
    expect(replace).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fdevices%2Fregister")
  })

  it("explains when registration isn't enforced, and requires the serial", async () => {
    renderAs("ADMIN")
    expect(await screen.findByText("Registration isn't enforced yet; you can register tills in advance.")).toBeInTheDocument()
    expect(screen.getByLabelText("Serial number")).toBeInTheDocument()

    await registerWith("Till 1", "   ")
    expect(screen.getByText("Serial number is required.")).toBeInTheDocument()
    expect(calls("POST", "/admin/devices")).toHaveLength(0)
  })

  it("has no notice in required mode, and an optional serial when the server allows it", async () => {
    config = { mode: "required", multiBrowserEnabled: false, requireSerial: false }
    renderAs("ADMIN")
    expect(await screen.findByLabelText("Serial number (optional)")).toBeInTheDocument()
    expect(screen.queryByText(/isn't enforced yet/)).not.toBeInTheDocument()
  })

  it("shows the current registration instead of the form", async () => {
    lists = [[till({}, true)]]
    renderAs("ADMIN")
    expect(await screen.findByText("This browser is registered as Till 1.")).toBeInTheDocument()
    expect(screen.queryByLabelText(/Till name/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open Registered tills" })).toHaveAttribute("href", "/devices")
  })
})

describe("Register this till: outcomes", () => {
  it("registers, confirms the cookie stuck, and signs out to the POS", async () => {
    lists = [[], [till({}, true)]]
    registerResponses = [() => json(201, till({}, true))]
    renderAs("ADMIN")

    await registerWith("Till 1", " pf3x 9k2b ", "BC-0042")

    expect(bodyOf("POST", "/admin/devices")).toEqual({ name: "Till 1", serialNumber: "pf3x 9k2b", assetTag: "BC-0042" })
    expect(await screen.findByText("This browser is now registered as Till 1.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Manage tills" })).toHaveAttribute("href", "/devices")

    await clickButton("Sign out and return to the POS")
    expect(localStorage.getItem("bar-talk.auth")).toBeNull()
    expect(calls("POST", "/auth/logout")).toHaveLength(1)
    expect(replace).toHaveBeenCalledWith("/pos/login")
  })

  it("names the till from the response when this browser joined an existing till", async () => {
    const existing = till({ name: "Front Till", credentials: [] })
    lists = [[existing], [till({ name: "Front Till" }, true)]]
    registerResponses = [() => json(201, till({ name: "Front Till" }, true))]
    renderAs("ADMIN")

    await registerWith("Typed name", "PF3X9K2B")

    expect(await screen.findByText("This browser has been added to Front Till.")).toBeInTheDocument()
  })

  it("spots a cookie that didn't stick and offers to remove the registration", async () => {
    lists = [[], []]
    registerResponses = [() => json(201, till())]
    renderAs("ADMIN")

    await registerWith("Till 1", "PF3X9K2B")

    expect(await screen.findByText(/This browser didn't keep the till cookie\./)).toBeInTheDocument()
    await clickButton("Remove this registration")
    await clickButton("Remove", screen.getByRole("dialog"))

    expect(calls("POST", "/admin/devices/d1/credentials/c1/revoke")).toHaveLength(1)
    expect(screen.getByText("The registration has been removed.")).toBeInTheDocument()
  })

  it("explains DEVICE_SERIAL_IN_USE with the normalised serial", async () => {
    registerResponses = [
      () => json(409, { error: "x", code: "DEVICE_SERIAL_IN_USE", details: { deviceId: "d1", deviceName: "Till 1" } }),
    ]
    renderAs("ADMIN")

    await registerWith("Till 2", " ab 12-c ")

    expect(
      screen.getByText("Serial AB12-C is already registered as Till 1. Revoke its browser (or the till) in Registered tills first."),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open Registered tills" })).toHaveAttribute("href", "/devices#device-d1")
  })

  it("confirms and joins on DEVICE_SERIAL_EXISTS", async () => {
    config = { mode: "required", multiBrowserEnabled: true, requireSerial: true }
    lists = [[till()], [till({}, true)]]
    registerResponses = [
      () => json(409, { error: "x", code: "DEVICE_SERIAL_EXISTS", details: { deviceId: "d1", deviceName: "Till 1" } }),
      () => json(201, till({}, true)),
    ]
    renderAs("ADMIN")

    await registerWith("Till 1 back", "pf3x9k2b")
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Serial PF3X9K2B is already registered as Till 1. Add this browser to it?")).toBeInTheDocument()
    await clickButton("Add this browser", dialog)

    expect(bodyOf("POST", "/admin/devices", 1)).toMatchObject({ joinDeviceId: "d1" })
    expect(await screen.findByText("This browser has been added to Till 1.")).toBeInTheDocument()
  })

  it("explains DEVICE_ASSET_TAG_IN_USE", async () => {
    registerResponses = [
      () => json(409, { error: "x", code: "DEVICE_ASSET_TAG_IN_USE", details: { deviceId: "d1", deviceName: "Till 1" } }),
    ]
    renderAs("ADMIN")
    await registerWith("Till 2", "S2", " BC-0042 ")
    expect(screen.getByText("Asset tag BC-0042 is already used by Till 1.")).toBeInTheDocument()
  })

  it("explains DEVICE_ALREADY_REGISTERED", async () => {
    registerResponses = [
      () =>
        json(409, {
          error: "x",
          code: "DEVICE_ALREADY_REGISTERED",
          details: { deviceId: "d1", deviceName: "Till 1", credentialId: "c1" },
        }),
    ]
    renderAs("ADMIN")
    await registerWith("Till 2", "S2")
    expect(
      screen.getByText("This browser is already registered as Till 1. To move it to another till, revoke this browser first."),
    ).toBeInTheDocument()
  })

  it("shows the error and reloads the settings on DEVICE_JOIN_MISMATCH", async () => {
    registerResponses = [() => json(409, { error: "The serial no longer matches. Start again.", code: "DEVICE_JOIN_MISMATCH" })]
    renderAs("ADMIN")
    await screen.findByLabelText(/Till name/)
    const configLoads = calls("GET", "/admin/devices/config").length

    await registerWith("Till 2", "S2")

    expect(screen.getByText("The serial no longer matches. Start again.")).toBeInTheDocument()
    expect(calls("GET", "/admin/devices/config").length).toBe(configLoads + 1)
  })

  it("keeps the form and goes to password sign-in on REAUTH_REQUIRED", async () => {
    registerResponses = [() => json(403, { error: "Sign in again with your password to manage tills.", code: "REAUTH_REQUIRED" })]
    renderAs("ADMIN")

    await registerWith("Till 1", "PF3X9K2B", "BC-0042")

    expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fdevices%2Fregister")
    expect(JSON.parse(String(sessionStorage.getItem("devices.register.draft")))).toEqual({
      name: "Till 1",
      serialNumber: "PF3X9K2B",
      assetTag: "BC-0042",
    })
  })

  it("restores the form after the re-sign-in, then forgets it", async () => {
    sessionStorage.setItem("devices.register.draft", JSON.stringify({ name: "Till 1", serialNumber: "PF3X9K2B", assetTag: "BC-0042" }))
    renderAs("ADMIN")

    expect(await screen.findByDisplayValue("Till 1")).toBeInTheDocument()
    expect(screen.getByDisplayValue("PF3X9K2B")).toBeInTheDocument()
    expect(screen.getByDisplayValue("BC-0042")).toBeInTheDocument()
    expect(sessionStorage.getItem("devices.register.draft")).toBeNull()
  })

  it("shows 400 field errors next to the fields", async () => {
    registerResponses = [() => json(400, { name: "Name is too long", serialNumber: "Serial is invalid" })]
    renderAs("ADMIN")
    await registerWith("Till 1", "PF3X9K2B")
    expect(screen.getByText("Name is too long")).toBeInTheDocument()
    expect(screen.getByText("Serial is invalid")).toBeInTheDocument()
  })
})
