// O4 task 7: End shift waits for this shift's offline sales still to send, and says how many.
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ShiftProvider } from "@/contexts/shift-context"
import PosMainPage from "@/app/pos/page"
import { resetLockBlockers } from "@/lib/lock-guard"
import type { OutboxEntry } from "@/lib/offline/outbox"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/components/pos/order-builder", () => ({ PosOrderBuilder: () => <div>order builder</div> }))

let outboxEntries: OutboxEntry[]
vi.mock("@/contexts/outbox-context", () => ({
  useOutbox: () => ({ entries: outboxEntries, loaded: true, summary: { pendingCount: 0, pending: [], oldestPendingSoldAt: null }, refresh: async () => {} }),
}))

const entry = (shiftId: number, status: OutboxEntry["status"], handed = false) =>
  ({ shiftId, status, handedToSupport: handed ? { at: "x", by: "Admin", reason: "support" } : null }) as OutboxEntry

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  resetLockBlockers()
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem(
    "bar-talk.auth",
    JSON.stringify({ token: "a.b.c", user: { email: "17", name: "Thandi Mokoena", role: "CASHIER", cashierId: 17 } }),
  )
  outboxEntries = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
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
      return json(200, {})
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    <AuthProvider>
      <ShiftProvider>
        <PosMainPage />
      </ShiftProvider>
    </AuthProvider>,
  )
}

describe("End shift with offline sales still to send", () => {
  it("is disabled, with the count shown", async () => {
    outboxEntries = [entry(412, "PENDING"), entry(412, "PENDING"), entry(412, "INVALID")]
    renderPage()
    const endShift = await screen.findByRole("button", { name: /End shift/ })
    expect(endShift).toBeDisabled()
    expect(endShift).toHaveAttribute("title", "3 offline sales still to send")
    expect(screen.getByText("3 offline sales still to send")).toBeInTheDocument()
  })

  it("counts only this shift's sales, not sent ones or ones handed to support", async () => {
    outboxEntries = [entry(411, "PENDING"), entry(412, "SYNCED"), entry(412, "REFUSED", true)]
    renderPage()
    const endShift = await screen.findByRole("button", { name: /End shift/ })
    await waitFor(() => expect(endShift).toBeEnabled())
    expect(screen.queryByText(/still to send/)).not.toBeInTheDocument()
  })

  it("says 1 sale in the singular", async () => {
    outboxEntries = [entry(412, "PENDING")]
    renderPage()
    expect(await screen.findByText("1 offline sale still to send")).toBeInTheDocument()
  })
})
