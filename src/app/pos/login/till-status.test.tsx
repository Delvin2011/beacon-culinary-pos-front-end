// O2: the POS sign-in screen shows this till and who holds its shift (GET /pos/till-status), and the till rules.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useContext, useEffect } from "react"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import PosLoginPage from "@/app/pos/login/page"
import { LoginForm } from "@/components/login-form"
import type { TillStatus } from "@/lib/till"

const replace = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next/image", () => ({ default: () => null }))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const thandi = { id: 17, name: "Thandi Mokoena" }
const sipho = { id: 23, name: "Sipho Dlamini" }

const registered = (shift: TillStatus["shift"]): TillStatus => ({
  registered: true,
  tillCode: "T1",
  tillName: "Till 1 (front)",
  shift,
  idleLockMinutes: 5,
  requireRegistered: false,
})
const shiftOf = (locked: boolean): TillStatus["shift"] => ({
  shiftId: 412,
  ownerId: 17,
  ownerName: "Thandi Mokoena",
  openedAt: "2026-11-18T05:58:12Z",
  locked,
})

let statuses: TillStatus[] = []
let pinAnswer: () => Response = () => json(401, {})
const statusReads = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/pos/till-status")).length

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  replace.mockReset()
  statuses = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/users/cashiers")) return json(200, [thandi, sipho])
    if (url.endsWith("/pos/till-status")) {
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]
      return status ? json(200, status) : json(500, {})
    }
    if (url.endsWith("/auth/pin-login")) return pinAnswer()
    return json(204, {})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <AuthProvider>
      <PosLoginPage />
    </AuthProvider>,
  )
}

async function signInAs(name: RegExp, pin = "123456") {
  const tile = await screen.findByRole("button", { name })
  await act(async () => {
    fireEvent.click(tile)
  })
  for (const digit of pin) {
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: digit }))
    })
  }
}

describe("till status on the sign-in screen", () => {
  it("unregistered, requireRegistered off: no till line, tiles shown", async () => {
    statuses = [{ registered: false, tillCode: null, tillName: null, shift: null, idleLockMinutes: 5, requireRegistered: false }]
    renderPage()
    expect(await screen.findByRole("button", { name: /Thandi Mokoena/ })).toBeInTheDocument()
    await waitFor(() => expect(statusReads()).toBe(1))
    expect(screen.queryByText(/T1|Unregistered till/)).not.toBeInTheDocument()
  })

  it("unregistered, requireRegistered on: the not-registered screen, no POS sign-in", async () => {
    statuses = [{ registered: false, tillCode: null, tillName: null, shift: null, idleLockMinutes: 5, requireRegistered: true }]
    renderPage()
    expect(await screen.findByText("This till is not registered. Ask a manager to register it.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Thandi Mokoena/ })).not.toBeInTheDocument()
  })

  it("registered, no shift: the till line only", async () => {
    statuses = [registered(null)]
    renderPage()
    expect(await screen.findByText("T1 · Till 1 (front)")).toBeInTheDocument()
    expect(screen.queryByText(/can sign in/)).not.toBeInTheDocument()
  })

  it("shift open and in use: 'In use by', the owner's tile highlighted", async () => {
    statuses = [registered(shiftOf(false))]
    renderPage()
    expect(await screen.findByText(/In use by Thandi Mokoena\. Only Thandi Mokoena or a manager can sign in\./)).toBeInTheDocument()
    const tile = screen.getByRole("button", { name: /Thandi Mokoena/ })
    expect(within(tile).getByText("Signed in")).toBeInTheDocument()
    expect(tile.className).toContain("ring-amber-300")
    expect(screen.getByRole("button", { name: /Sipho Dlamini/ }).className).not.toContain("ring-amber-300")
  })

  it("locked: 'T1 is locked. Shift of … since …', resume prompt on the owner's tile", async () => {
    statuses = [registered(shiftOf(true))]
    renderPage()
    const time = new Date("2026-11-18T05:58:12Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    expect(await screen.findByText(new RegExp(`T1 is locked\\. Shift of Thandi Mokoena since ${time}\\.`))).toBeInTheDocument()
    expect(within(screen.getByRole("button", { name: /Thandi Mokoena/ })).getByText("Shift open · tap to resume")).toBeInTheDocument()
  })
})

describe("signing in on a till with a shift", () => {
  it("the owner resumes", async () => {
    statuses = [registered(shiftOf(true))]
    pinAnswer = () => json(200, { token: "a.b.c", user: { name: "Thandi Mokoena", role: "CASHIER" } })
    renderPage()
    await signInAs(/Thandi Mokoena/)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/pos"))
  })

  it("someone else gets TILL_LOCKED, and the till status is read again", async () => {
    statuses = [registered(shiftOf(true))]
    pinAnswer = () => json(409, { error: "x", code: "TILL_LOCKED", details: { ownerName: "Thandi Mokoena", tillCode: "T1" } })
    renderPage()
    await signInAs(/Sipho Dlamini/)
    expect(await screen.findByText("In use by Thandi Mokoena (T1). Only they or a manager can sign in.")).toBeInTheDocument()
    await waitFor(() => expect(statusReads()).toBe(2))
    expect(replace).not.toHaveBeenCalledWith("/pos")
  })

  it("a manager signs in on a locked till", async () => {
    statuses = [registered(shiftOf(true))]
    pinAnswer = () => json(200, { token: "a.b.c", user: { name: "Sipho Dlamini", role: "ADMIN" } })
    renderPage()
    await signInAs(/Sipho Dlamini/)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/pos"))
  })

  it("SHIFT_OPEN_ON_OTHER_TILL names the other till", async () => {
    statuses = [registered(null)]
    pinAnswer = () => json(409, { error: "x", code: "SHIFT_OPEN_ON_OTHER_TILL", details: { tillCode: "T2", tillName: "Till 2 (back)" } })
    renderPage()
    await signInAs(/Sipho Dlamini/)
    expect(await screen.findByText("You have an open shift on T2. Close it there first, or ask a manager.")).toBeInTheDocument()
  })
})

describe("after the server ended the session", () => {
  it("shows the reason on the sign-in screen", async () => {
    statuses = [registered(shiftOf(true))]
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "t@x", role: "CASHIER" } }))
    // Rendered signed in, so the page would go to /pos; the probe ends the session first.
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/users/cashiers")) return json(200, [thandi, sipho])
      if (url.endsWith("/pos/till-status")) return json(200, statuses[0])
      if (url.endsWith("/auth/refresh")) return json(401, { error: "x", code: "SESSION_ENDED", details: { reason: "REPLACED" } })
      if (url.endsWith("/menu/today")) return new Response(null, { status: 401 })
      return json(204, {})
    })
    function EndSession() {
      const auth = useContext(AuthContext)
      useEffect(() => {
        void auth?.authFetch("/menu/today")
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return null
    }
    render(
      <AuthProvider>
        <EndSession />
        <PosLoginPage />
      </AuthProvider>,
    )
    expect(await screen.findByText("You were signed out because a newer sign-in replaced this one.")).toBeInTheDocument()
  })
})

describe("password sign-in", () => {
  it("TILL_LOCKED shows the till message, not the server text", async () => {
    fetchMock.mockImplementation(async () =>
      json(409, { error: "Server wording", code: "TILL_LOCKED", details: { ownerName: "Thandi Mokoena", tillCode: "T1" } }),
    )
    render(
      <AuthProvider>
        <LoginForm />
      </AuthProvider>,
    )
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "s@x.co" } })
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret1" } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /login/i }))
    })
    expect(await screen.findByText("In use by Thandi Mokoena (T1). Only they or a manager can sign in.")).toBeInTheDocument()
    expect(screen.queryByText("Server wording")).not.toBeInTheDocument()
  })
})
