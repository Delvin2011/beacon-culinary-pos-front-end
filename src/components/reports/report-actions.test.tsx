// O2: a sign-off refused with SHIFT_UNCOUNTED links to where the count (or "no count") is recorded.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ReportActions } from "@/components/reports/report-actions"
import type { ReportAction } from "@/lib/reports"

const fetchMock = vi.fn<typeof fetch>()

const signOff: ReportAction = { key: "signoff", label: "Sign off", method: "POST", path: "/admin/shifts/412/signoff", enabled: true }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", role: "ADMIN" } }))
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function runSignOff() {
  render(
    <AuthProvider>
      <ReportActions actions={[signOff]} onDone={vi.fn()} />
    </AuthProvider>,
  )
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Sign off" }))
  })
}

describe("sign-off of an uncounted shift", () => {
  it("SHIFT_UNCOUNTED: shows the refusal and links to the shift in POS Activity", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Shift #412 was force-closed without a cash count. Record the count or confirm there is no count.",
          code: "SHIFT_UNCOUNTED",
          details: { shiftId: 412 },
        }),
        { status: 409 },
      ),
    )
    await runSignOff()
    expect(await screen.findByText(/force-closed without a cash count/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Record the count or confirm there is no count" })).toHaveAttribute(
      "href",
      "/pos-activity?shiftId=412",
    )
  })

  it("any other refusal has no such link", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Already signed off.", code: "ALREADY_SIGNED_OFF" }), { status: 409 }))
    await runSignOff()
    expect(await screen.findByText(/Already signed off/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Record the count/ })).not.toBeInTheDocument()
  })
})
