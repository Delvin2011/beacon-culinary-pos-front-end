// The POS page goes to shift-open only when the server says there is no open shift (404). A lookup that gets no
// answer keeps the last known shift, or shows "Can't reach the server" with Retry when there is none yet.
import { useContext, type ContextType } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ShiftContext, ShiftProvider } from "@/contexts/shift-context"
import PosMainPage from "@/app/pos/page"
import { CONNECTION_MESSAGES } from "@/lib/net"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))
vi.mock("@/components/pos/order-builder", () => ({ PosOrderBuilder: () => <div>order builder</div> }))

const fetchMock = vi.fn<typeof fetch>()
let shiftAnswer: () => Promise<Response>

const openShift = () =>
  new Response(
    JSON.stringify({ shiftId: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 500, ownedByCaller: true }),
    { status: 200 },
  )

type ShiftCtx = NonNullable<ContextType<typeof ShiftContext>>
let shiftCtx: ShiftCtx | undefined
function ShiftProbe() {
  shiftCtx = useContext(ShiftContext)
  return null
}

function renderPos() {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
  render(
    <AuthProvider>
      <ShiftProvider>
        <ShiftProbe />
        <PosMainPage />
      </ShiftProvider>
    </AuthProvider>,
  )
}

const redirectedToShiftOpen = () => replace.mock.calls.some(([path]) => path === "/pos/shift-open")

beforeEach(() => {
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/shifts/open")) return shiftAnswer()
    return new Response("{}", { status: 200 })
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("POS shift lookup", () => {
  it("doesn't redirect on a network error, and Retry loads the shift", async () => {
    shiftAnswer = () => Promise.reject(new TypeError("Failed to fetch"))
    renderPos()

    expect(await screen.findByText("Can't reach the server")).toBeInTheDocument()
    expect(screen.getByText(CONNECTION_MESSAGES.network)).toBeInTheDocument()
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument()
    expect(redirectedToShiftOpen()).toBe(false)

    shiftAnswer = async () => openShift()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }))
    })

    expect(await screen.findByText("Shift Open")).toBeInTheDocument()
    expect(redirectedToShiftOpen()).toBe(false)
  })

  it("doesn't redirect on a 5xx", async () => {
    shiftAnswer = async () => new Response("{}", { status: 503 })
    renderPos()

    expect(await screen.findByText(CONNECTION_MESSAGES.server)).toBeInTheDocument()
    expect(redirectedToShiftOpen()).toBe(false)
  })

  it("redirects to shift-open on a 404", async () => {
    shiftAnswer = async () => new Response(JSON.stringify({ code: "NO_OPEN_SHIFT" }), { status: 404 })
    renderPos()

    await vi.waitFor(() => expect(redirectedToShiftOpen()).toBe(true))
  })

  it("keeps the last known shift when a refetch fails, without the full-screen loader", async () => {
    shiftAnswer = async () => openShift()
    renderPos()
    expect(await screen.findByText("order builder")).toBeInTheDocument()

    shiftAnswer = () => Promise.reject(new TypeError("Failed to fetch"))
    await act(async () => {
      const pending = shiftCtx!.refetch()
      // A quiet refetch: the till stays on screen while it runs.
      expect(screen.queryByText("Loading…")).not.toBeInTheDocument()
      await pending
    })

    expect(screen.getByText("order builder")).toBeInTheDocument()
    expect(screen.getByText(/Showing the last known shift/)).toBeInTheDocument()
    expect(shiftCtx!.shift?.id).toBe(7)
    expect(redirectedToShiftOpen()).toBe(false)
  })
})
