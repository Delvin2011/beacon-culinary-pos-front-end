import type { ReactNode } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import RegisteredTillsPage from "@/app/devices/page"
import type { Device, DeviceConfig, DeviceCredential } from "@/lib/devices"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

const ORIGINAL_TZ = process.env.TZ
const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function browser(overrides: Partial<DeviceCredential> = {}): DeviceCredential {
  return {
    id: "c1",
    browserLabel: "Edge on Windows",
    status: "ACTIVE",
    createdBy: "Canteen Admin",
    createdAt: "2026-11-13T09:00:00Z",
    lastSeenAt: "2026-11-13T09:00:00Z",
    lastSeenIp: "203.0.113.7",
    revokedAt: null,
    thisBrowser: false,
    ...overrides,
  }
}

function till(overrides: Partial<Device> = {}): Device {
  return {
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
    thisDevice: false,
    credentials: [browser()],
    ...overrides,
  }
}

let config: DeviceConfig
let list: Device[]
let actionResponse: () => Response

const calls = (method: string, pathEnd: string) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(pathEnd) && (init?.method ?? "GET") === method)
const bodyOf = (method: string, pathEnd: string) => {
  const raw = calls(method, pathEnd)[0]?.[1]?.body
  return raw ? JSON.parse(String(raw)) : undefined
}

function renderAs(role: string) {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "admin@x.co", role } }))
  render(
    <AuthProvider>
      <RegisteredTillsPage />
    </AuthProvider>,
  )
}

const card = (name: string) => screen.getByRole("heading", { name }).closest("li") as HTMLElement

async function click(name: string | RegExp, container: HTMLElement = document.body) {
  const button = within(container).getByRole("button", { name })
  await act(async () => {
    fireEvent.click(button)
  })
}

beforeEach(() => {
  process.env.TZ = "Africa/Johannesburg"
  push.mockReset()
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  config = { mode: "required", multiBrowserEnabled: false, requireSerial: true }
  list = [till()]
  actionResponse = () => json(200, till())
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    if (url.endsWith("/admin/devices/config")) return json(200, config)
    if (url.endsWith("/admin/devices") && method === "GET") return json(200, list)
    if (method === "PUT" || method === "POST") return actionResponse()
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
  vi.unstubAllGlobals()
})

describe("Registered tills: list", () => {
  it("is admin only", async () => {
    renderAs("HEAD_CHEF")
    await act(async () => {})
    expect(replace).toHaveBeenCalledWith("/dashboard")
    expect(calls("GET", "/admin/devices")).toHaveLength(0)
  })

  it("shows an empty state", async () => {
    list = []
    renderAs("ADMIN")
    expect(await screen.findByText("No tills are registered yet.")).toBeInTheDocument()
  })

  it("shows the settings, markers, statuses and local times", async () => {
    list = [
      till({
        thisDevice: true,
        credentials: [
          browser({ thisBrowser: true }),
          browser({ id: "c2", browserLabel: "Old Chrome", status: "EXPIRED" }),
          browser({ id: "c3", browserLabel: "Reinstalled Edge", status: "REVOKED", revokedAt: "2026-11-12T08:00:00Z", revokedBy: "Sam Admin", revokeReason: "Browser reinstalled" }),
        ],
      }),
    ]
    renderAs("ADMIN")

    expect(await screen.findByText("Required (only registered tills)")).toBeInTheDocument()
    expect(screen.getByText("Not allowed")).toBeInTheDocument()
    expect(screen.getByText("Required")).toBeInTheDocument()

    const tillCard = card("Till 1")
    expect(within(tillCard).getByText("This till")).toBeInTheDocument()
    expect(within(tillCard).getByText("This browser")).toBeInTheDocument()
    expect(within(tillCard).getByText("Expired: register this browser again")).toBeInTheDocument()
    expect(within(tillCard).getByText(/Serial PF3X9K2B · Asset tag BC-0042/)).toBeInTheDocument()
    // 09:00Z is 11:00 in Johannesburg.
    expect(within(tillCard).getAllByText(/Last seen 13 Nov 2026 11:00 from 203\.0\.113\.7/)).toHaveLength(3)
    expect(within(tillCard).getByText("Revoked by Sam Admin on 12 Nov 2026 10:00 · Reason: Browser reinstalled")).toBeInTheDocument()
    // No actions on a revoked browser: Rename/Revoke only for the active and expired ones.
    expect(within(tillCard).getAllByRole("button", { name: "Rename" })).toHaveLength(2)
  })

  it("puts revoked tills in a collapsed section without actions", async () => {
    list = [
      till(),
      till({
        id: "d2",
        name: "Old Till",
        status: "REVOKED",
        revokedAt: "2026-11-10T07:30:00Z",
        revokedBy: "Sam Admin",
        revokeReason: "Replaced",
        credentials: [browser({ id: "c9", status: "REVOKED", revokedAt: "2026-11-10T07:30:00Z" })],
      }),
    ]
    renderAs("ADMIN")

    await screen.findByText("Revoked tills (1)")
    const details = screen.getByText("Revoked tills (1)").closest("details") as HTMLDetailsElement
    expect(details.open).toBe(false)
    const oldCard = within(details).getByRole("heading", { name: "Old Till" }).closest("li") as HTMLElement
    expect(within(oldCard).getByText("Revoked by Sam Admin on 10 Nov 2026 09:30 · Reason: Replaced")).toBeInTheDocument()
    expect(within(oldCard).queryByRole("button")).not.toBeInTheDocument()
  })
})

describe("Registered tills: actions", () => {
  it("revokes one browser, warning about this browser and the last browser, with the reason", async () => {
    list = [till({ thisDevice: true, credentials: [browser({ thisBrowser: true })] })]
    actionResponse = () => json(200, till({ credentials: [browser({ status: "REVOKED", revokedAt: "2026-11-13T10:00:00Z" })] }))
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    await click("Revoke browser", card("Till 1"))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/This is the browser you're using\. When registration is required, this POS stops working/)).toBeInTheDocument()
    expect(within(dialog).getByText(/last active browser: the till stays registered with no browsers/)).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Browser reinstalled" } })
    await click("Revoke browser", dialog)

    expect(bodyOf("POST", "/admin/devices/d1/credentials/c1/revoke")).toEqual({ reason: "Browser reinstalled" })
    expect(within(card("Till 1")).getByText("Revoked")).toBeInTheDocument()
    expect(within(card("Till 1")).getByText(/No active browser/)).toBeInTheDocument()
  })

  it("revokes the whole till with no reason, explaining the serial is freed", async () => {
    list = [till({ thisDevice: true })]
    actionResponse = () => json(200, till({ status: "REVOKED", revokedAt: "2026-11-13T10:00:00Z", revokedBy: "Canteen Admin" }))
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    await click("Revoke till", card("Till 1"))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/serial number and asset tag become free to register as a new till/)).toBeInTheDocument()
    expect(within(dialog).getByText(/This is the till you're using\./)).toBeInTheDocument()
    await click("Revoke till", dialog)

    expect(calls("POST", "/admin/devices/d1/revoke")).toHaveLength(1)
    expect(bodyOf("POST", "/admin/devices/d1/revoke")).toBeUndefined()
    expect(screen.getByText("Revoked tills (1)")).toBeInTheDocument()
  })

  it("edits with all three fields, clearing a blank asset tag", async () => {
    actionResponse = () => json(200, till({ name: "Till 1 (front)", assetTag: null }))
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    await click("Edit", card("Till 1"))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByLabelText("Till name")).toHaveValue("Till 1")
    fireEvent.change(within(dialog).getByLabelText("Till name"), { target: { value: "Till 1 (front)" } })
    fireEvent.change(within(dialog).getByLabelText("Asset tag (optional)"), { target: { value: "" } })
    await click("Save", dialog)

    expect(bodyOf("PUT", "/admin/devices/d1")).toEqual({ name: "Till 1 (front)", serialNumber: "PF3X9K2B", assetTag: null })
    expect(screen.getByRole("heading", { name: "Till 1 (front)" })).toBeInTheDocument()
  })

  it("keeps a serial conflict in the edit dialog", async () => {
    actionResponse = () => json(409, { error: "x", code: "DEVICE_SERIAL_IN_USE", details: { deviceId: "d2", deviceName: "Till 2" } })
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    await click("Edit", card("Till 1"))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Serial number"), { target: { value: " zz 99 " } })
    await click("Save", dialog)

    expect(within(screen.getByRole("dialog")).getByText("Serial ZZ99 is already registered as Till 2.")).toBeInTheDocument()
  })

  it("renames a browser", async () => {
    actionResponse = () => json(200, till({ credentials: [browser({ browserLabel: "Edge (kiosk)" })] }))
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    await click("Rename", card("Till 1"))
    const dialog = screen.getByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Browser name"), { target: { value: "Edge (kiosk)" } })
    await click("Save", dialog)

    expect(bodyOf("PUT", "/admin/devices/d1/credentials/c1")).toEqual({ browserLabel: "Edge (kiosk)" })
    expect(within(card("Till 1")).getByText("Edge (kiosk)")).toBeInTheDocument()
  })

  it.each([
    ["DEVICE_REVOKED", () => json(409, { error: "This till has been revoked.", code: "DEVICE_REVOKED" })],
    ["404", () => json(404, undefined)],
  ])("reloads the list on %s", async (_name, response) => {
    actionResponse = response
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    const listLoads = calls("GET", "/admin/devices").length
    await click("Rename", card("Till 1"))
    fireEvent.change(within(screen.getByRole("dialog")).getByLabelText("Browser name"), { target: { value: "x" } })
    await click("Save", screen.getByRole("dialog"))

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText(/The list has been reloaded\./)).toBeInTheDocument()
    expect(calls("GET", "/admin/devices").length).toBe(listLoads + 1)
  })

  it("goes to password sign-in on REAUTH_REQUIRED", async () => {
    actionResponse = () => json(403, { error: "Sign in again with your password to manage tills.", code: "REAUTH_REQUIRED" })
    renderAs("ADMIN")

    await screen.findByRole("heading", { name: "Till 1" })
    await click("Revoke till", card("Till 1"))
    await click("Revoke till", screen.getByRole("dialog"))

    expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fdevices")
  })
})
