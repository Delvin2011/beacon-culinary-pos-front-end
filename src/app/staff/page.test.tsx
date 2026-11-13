import type { ReactNode } from "react"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import StaffPage from "@/app/staff/page"
import { lockLabel, type StaffLock, type StaffMember } from "@/lib/staff"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

const fetchMock = vi.fn<typeof fetch>()
const unlocked: StaffLock = { locked: false, lockedUntil: null, requiresAdminUnlock: false }
const passwordLock: StaffLock = {
  locked: true,
  lockedUntil: new Date(Date.now() + 15 * 60_000).toISOString(),
  requiresAdminUnlock: false,
}
const pinLock: StaffLock = { locked: true, lockedUntil: null, requiresAdminUnlock: true }

const ann: StaffMember = {
  id: 1,
  name: "Ann Lee",
  email: "ann@x.co",
  role: "ADMIN",
  active: true,
  hasPassword: true,
  hasPin: true,
  locks: { PASSWORD: passwordLock, PIN: pinLock },
}
const bob: StaffMember = {
  id: 2,
  name: "Bob Ray",
  email: null,
  role: "CASHIER",
  active: true,
  hasPassword: false,
  hasPin: true,
  locks: { PASSWORD: unlocked, PIN: unlocked },
}
const roles = [
  { role: "ADMIN", label: "Admin", password: "REQUIRED", pin: "REQUIRED" },
  { role: "CASHIER", label: "Cashier", password: "NONE", pin: "REQUIRED" },
]

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

let unlockResponse: () => Response
let staffList: StaffMember[]

function renderAs(role: string) {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", role } }))
  render(
    <AuthProvider>
      <StaffPage />
    </AuthProvider>,
  )
}

const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  staffList = [ann, bob]
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/admin/staff/roles")) return json(200, roles)
    if (url.endsWith("/admin/staff")) return json(200, staffList)
    if (/\/admin\/staff\/\d+\/unlock$/.test(url)) return unlockResponse()
    throw new Error(`Unexpected request ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Staff page locks", () => {
  it("shows lock badges only on the locked row, and Unlock on every active row", async () => {
    const carl: StaffMember = { ...bob, id: 4, name: "Carl Inactive", active: false }
    staffList = [ann, bob, carl]
    unlockResponse = () => json(200, ann)
    renderAs("ADMIN")

    await screen.findByText("Ann Lee")
    expect(within(row("Ann Lee")).getByText(lockLabel("PASSWORD", passwordLock))).toBeInTheDocument()
    expect(within(row("Ann Lee")).getByText("PIN locked: needs unlock")).toBeInTheDocument()
    expect(within(row("Ann Lee")).getByRole("button", { name: "Unlock" })).toBeInTheDocument()
    // Bob may have a short PIN block, which `locks` doesn't list.
    expect(within(row("Bob Ray")).queryByText(/locked/)).not.toBeInTheDocument()
    expect(within(row("Bob Ray")).getByRole("button", { name: "Unlock" })).toBeInTheDocument()
    // An inactive person can't sign in anyway.
    expect(within(row("Carl Inactive")).queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument()
  })

  it("clears a short block for someone with no listed lock", async () => {
    unlockResponse = () => json(200, bob)
    renderAs("ADMIN")

    await screen.findByText("Bob Ray")
    await act(async () => {
      fireEvent.click(within(row("Bob Ray")).getByRole("button", { name: "Unlock" }))
    })
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText(/No account lock is showing, but they may have a short block/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Unlock" }))
    })

    const unlockCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/admin/staff/2/unlock"))
    expect(unlockCall?.[1]?.method).toBe("POST")
    expect(unlockCall?.[1]?.body).toBeUndefined()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("confirms, unlocks with no body, and updates the row from the response", async () => {
    unlockResponse = () => json(200, { ...ann, locks: { PASSWORD: unlocked, PIN: unlocked } })
    renderAs("ADMIN")

    await screen.findByText("Ann Lee")
    await act(async () => {
      fireEvent.click(within(row("Ann Lee")).getByRole("button", { name: "Unlock" }))
    })
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByText("Unlock Ann Lee?")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Unlock" }))
    })

    const unlockCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/admin/staff/1/unlock"))
    expect(unlockCall?.[1]?.method).toBe("POST")
    expect(unlockCall?.[1]?.body).toBeUndefined()
    expect(within(row("Ann Lee")).queryByText(/locked/)).not.toBeInTheDocument()
  })

  it("hides Unlock on the signed-in admin's own locked row", async () => {
    // renderAs signs in as me@x.co; the server has the email in a different case.
    const me: StaffMember = { ...ann, id: 3, name: "Me Admin", email: "Me@X.co" }
    staffList = [ann, me]
    renderAs("ADMIN")

    await screen.findByText("Me Admin")
    expect(within(row("Me Admin")).getByText("PIN locked: needs unlock")).toBeInTheDocument()
    expect(within(row("Me Admin")).queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument()
    expect(within(row("Ann Lee")).getByRole("button", { name: "Unlock" })).toBeInTheDocument()
  })

  it("shows a 404 plainly", async () => {
    unlockResponse = () => json(404, undefined)
    renderAs("ADMIN")

    await screen.findByText("Ann Lee")
    await act(async () => {
      fireEvent.click(within(row("Ann Lee")).getByRole("button", { name: "Unlock" }))
    })
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Unlock" }))
    })

    expect(screen.getByText("This staff member no longer exists. Refresh the list.")).toBeInTheDocument()
  })

  it("shows nothing to a non-admin and loads no staff", async () => {
    renderAs("CASHIER")
    await act(async () => {})
    expect(screen.queryByRole("button", { name: "Unlock" })).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/admin/staff"))).toBe(false)
  })
})
