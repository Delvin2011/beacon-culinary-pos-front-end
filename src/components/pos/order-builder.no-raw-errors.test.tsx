// When the server can't be reached, POS screens say so in plain words and never show the browser's "Failed to fetch".
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ConnectionProvider } from "@/contexts/connection-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import { ShiftReadingDialog } from "@/components/pos/shift-reading-dialog"
import { CONNECTION_MESSAGES } from "@/lib/net"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
  fetchMock.mockReset()
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("no raw fetch errors on POS screens", () => {
  it("the till", async () => {
    render(
      <AuthProvider>
        <ConnectionProvider>
          <PosOrderBuilder
            managementSessionToken={null}
            managementSessionActive={false}
            managementRemainingMs={0}
            requestManagementSession={vi.fn()}
            invalidateManagementSession={vi.fn()}
          />
        </ConnectionProvider>
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getAllByText(CONNECTION_MESSAGES.network).length).toBeGreaterThan(0))
    expect(document.body.textContent).not.toMatch(/Failed to fetch/i)
  })

  it("the shift reading", async () => {
    render(
      <AuthProvider>
        <ShiftReadingDialog shiftId={7} onClose={vi.fn()} />
      </AuthProvider>,
    )

    expect(await screen.findByText(CONNECTION_MESSAGES.network)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Failed to fetch/i)
  })
})
