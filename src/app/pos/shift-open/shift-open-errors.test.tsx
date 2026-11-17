// O2: opening a shift happens on this till. SHIFT_OPEN_ON_OTHER_TILL, SHIFT_ALREADY_OPEN and DEVICE_NOT_REGISTERED
// are told apart by their code.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ShiftProvider } from "@/contexts/shift-context"
import ShiftOpenPage from "@/app/pos/shift-open/page"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let openAnswer: () => Response
let tillShiftAfterOpen: Response | null = null

beforeEach(() => {
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "23", name: "Sipho", cashierId: 23 } }))
  tillShiftAfterOpen = null
  let opened = false
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith("/shifts/open") && init?.method === "POST") {
      opened = true
      return openAnswer()
    }
    if (url.endsWith("/shifts/open")) return opened && tillShiftAfterOpen ? tillShiftAfterOpen : json(404, {})
    return json(200, {})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function openShift() {
  render(
    <AuthProvider>
      <ShiftProvider>
        <ShiftOpenPage />
      </ShiftProvider>
    </AuthProvider>,
  )
  const button = await screen.findByRole("button", { name: "Open Shift" })
  await act(async () => {
    fireEvent.click(button)
  })
}

describe("opening a shift on this till", () => {
  it("SHIFT_OPEN_ON_OTHER_TILL names the other till and stays here", async () => {
    openAnswer = () =>
      json(409, { error: "x", code: "SHIFT_OPEN_ON_OTHER_TILL", details: { tillCode: "T2", tillName: "Till 2 (back)" } })
    await openShift()
    expect(await screen.findByText("You have an open shift on T2. Close it there first, or ask a manager.")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalledWith("/pos")
  })

  it("SHIFT_ALREADY_OPEN shows who holds the till, then moves on to /pos once the shift is loaded", async () => {
    openAnswer = () =>
      json(409, { error: "x", code: "SHIFT_ALREADY_OPEN", details: { shiftId: 412, ownerName: "Thandi Mokoena", tillCode: "T1" } })
    tillShiftAfterOpen = json(200, {
      shiftId: 412,
      owner: { id: 17, name: "Thandi Mokoena" },
      ownedByCaller: false,
      openedAt: "2026-11-18T05:58:12Z",
      openingFloat: 500,
      tillCode: "T1",
      tillName: "Till 1 (front)",
    })
    await openShift()
    expect(await screen.findByText("T1 already has an open shift (Thandi Mokoena).")).toBeInTheDocument()
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/pos"))
  })

  it("DEVICE_NOT_REGISTERED shows the existing message", async () => {
    openAnswer = () => json(403, { error: "x", code: "DEVICE_NOT_REGISTERED" })
    await openShift()
    expect(await screen.findByText("This till is not registered. Ask a manager to register it.")).toBeInTheDocument()
  })
})
