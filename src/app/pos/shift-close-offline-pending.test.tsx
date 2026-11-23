// O3 (offline contract 10.4): shift close refused with 409 OFFLINE_SALES_PENDING shows the count from details, not
// "already closed", and the shift stays open.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ShiftProvider } from "@/contexts/shift-context"
import PosMainPage from "@/app/pos/page"
import { resetLockBlockers } from "@/lib/lock-guard"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))
vi.mock("@/components/pos/order-builder", () => ({ PosOrderBuilder: () => <div>order builder</div> }))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
let closeAnswer: () => Response

beforeEach(() => {
  replace.mockReset()
  resetLockBlockers()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(
    "bar-talk.auth",
    JSON.stringify({ token: "a.b.c", user: { email: "17", name: "Thandi Mokoena", role: "CASHIER", cashierId: 17 } }),
  )
  closeAnswer = () =>
    json(409, {
      error: "This till still has 3 unsynced sales for this shift. Sync them before closing.",
      code: "OFFLINE_SALES_PENDING",
      details: { pendingCount: 3, lastReportAt: "2026-11-18T09:15:00Z", stale: false },
    })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^(?:https?:\/\/[^/]+)?\/api(?=\/)/, "")
    if (path === "/shifts/open") {
      return json(200, {
        shiftId: 412,
        owner: { id: 17, name: "Thandi Mokoena" },
        ownedByCaller: true,
        openedAt: "2026-11-18T05:58:12Z",
        openingFloat: 500,
        tillCode: "T1",
        tillName: "Till 1 (front)",
      })
    }
    if (path === "/shifts/412/summary") {
      return json(200, { shiftId: 412, openingFloat: 500, cashSalesTotal: 0, adjustmentsTotal: 0, expectedCash: 500, orderCount: 0 })
    }
    if (path === "/shifts/412/close" && init?.method === "POST") return closeAnswer()
    return json(200, {})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("shift close with unsynced offline sales", () => {
  it("says how many, from details.pendingCount, and keeps the shift open", async () => {
    // A different `error` text proves the message comes from the code and the count, not the server's words.
    closeAnswer = () =>
      json(409, { error: "Server wording", code: "OFFLINE_SALES_PENDING", details: { pendingCount: 3, stale: false } })
    render(
      <AuthProvider>
        <ShiftProvider>
          <PosMainPage />
        </ShiftProvider>
      </AuthProvider>,
    )
    // Found outside act(): inside it React holds the page's updates until act ends.
    const endShift = await screen.findByRole("button", { name: /End shift/ })
    await act(async () => {
      fireEvent.click(endShift)
    })
    for (const digit of ["5", "0", "0"]) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: digit }))
      })
    }
    const review = await screen.findByRole("button", { name: "Review Variance" })
    await act(async () => {
      fireEvent.click(review)
    })

    expect(await screen.findByText("This till still has 3 unsynced sales for this shift. Sync them before closing.")).toBeInTheDocument()
    expect(screen.queryByText(/already closed/)).not.toBeInTheDocument()
    expect(screen.queryByText("Server wording")).not.toBeInTheDocument()
    expect(screen.getByText("Shift Open")).toBeInTheDocument()
  })
})
