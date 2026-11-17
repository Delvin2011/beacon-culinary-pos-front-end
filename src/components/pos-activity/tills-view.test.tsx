// O2: the manager's Tills view (GET /admin/tills).
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { TillsView } from "@/components/pos-activity/tills-view"
import type { AdminTillRow } from "@/lib/tills-admin"

const fetchMock = vi.fn<typeof fetch>()

const rows: AdminTillRow[] = [
  {
    deviceId: "d-1",
    tillCode: "T1",
    tillName: "Till 1 (front)",
    registered: true,
    shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: true },
  },
  {
    deviceId: "d-2",
    tillCode: "T2",
    tillName: "Till 2 (back)",
    registered: true,
    shift: { shiftId: 414, ownerId: 19, ownerName: "Lerato Khumalo", openedAt: "2026-11-18T06:02:00Z", locked: false },
  },
  { deviceId: "d-3", tillCode: "T3", tillName: "Till 3 (bar)", registered: true, shift: null },
  {
    deviceId: null,
    tillCode: null,
    tillName: "Unregistered till",
    registered: false,
    shift: { shiftId: 415, ownerId: 23, ownerName: "Sipho Dlamini", openedAt: "2026-11-18T06:10:00Z", locked: null },
  },
]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", role: "ADMIN" } }))
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(rows), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function rowFor(label: string) {
  return screen.getByText(label).closest("tr") as HTMLElement
}

describe("Tills view", () => {
  it("shows each till's shift and lock state, and the unregistered till while it has a shift", async () => {
    const onForceClose = vi.fn()
    const onActivity = vi.fn()
    render(
      <AuthProvider>
        <TillsView reloadKey={0} onForceClose={onForceClose} onActivity={onActivity} />
      </AuthProvider>,
    )

    await screen.findByText("T1 · Till 1 (front)")
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/admin\/tills$/)

    const t1 = rowFor("T1 · Till 1 (front)")
    expect(within(t1).getByText("Thandi Mokoena")).toBeInTheDocument()
    expect(within(t1).getByText("Locked")).toBeInTheDocument()

    expect(within(rowFor("T2 · Till 2 (back)")).getByText("In use")).toBeInTheDocument()

    const t3 = rowFor("T3 · Till 3 (bar)")
    expect(within(t3).getByText("No shift")).toBeInTheDocument()
    expect(within(t3).queryByRole("button", { name: "Force close" })).not.toBeInTheDocument()
    expect(within(t3).getByRole("link", { name: "Device" })).toBeInTheDocument()

    const unregistered = rowFor("Unregistered till")
    expect(within(unregistered).getByText("Sipho Dlamini")).toBeInTheDocument()
    expect(within(unregistered).getByText("Shift open")).toBeInTheDocument()
    expect(within(unregistered).queryByRole("link", { name: "Device" })).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(t1).getByRole("button", { name: "Force close" }))
    })
    expect(onForceClose).toHaveBeenCalledWith(rows[0])
    await act(async () => {
      fireEvent.click(within(unregistered).getByRole("button", { name: "Activity" }))
    })
    expect(onActivity).toHaveBeenCalledWith(415)
  })
})
