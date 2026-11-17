// O2 force close: expected cash, reason, counted or not, variance reason, confirm; REAUTH keeps the form.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ForceCloseDialog } from "@/components/pos-activity/force-close-dialog"
import { loadForceCloseDraft } from "@/lib/tills-admin"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const target = { shiftId: 412, ownerName: "Thandi Mokoena", till: "T1 · Till 1 (front)" }
let closeAnswer: () => Response

const closeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/admin/shifts/412/force-close"))
const sentBody = () => JSON.parse(String(closeCalls()[0][1]?.body)) as Record<string, unknown>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", role: "ADMIN" } }))
  push.mockReset()
  closeAnswer = () => json(200, { id: 412, status: "CLOSED", forceClosed: true })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/admin/shifts/412/activity")) return json(200, { expectedCashBreakdown: { expectedCash: 1200 } })
    if (url.endsWith("/force-close")) return closeAnswer()
    return json(200, {})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderDialog(props: Partial<Parameters<typeof ForceCloseDialog>[0]> = {}) {
  const onDone = vi.fn()
  const onClose = vi.fn()
  render(
    <AuthProvider>
      <ForceCloseDialog target={target} onClose={onClose} onDone={onDone} {...props} />
    </AuthProvider>,
  )
  return { onDone, onClose }
}

async function fill({ reason, counted, cannotCount }: { reason: string; counted?: string; cannotCount?: boolean }) {
  expect(await screen.findByText("R 1 200,00")).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText("Reason (required)"), { target: { value: reason } })
  if (counted !== undefined) fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: counted } })
  if (cannotCount) fireEvent.click(screen.getByLabelText("Drawer can't be counted now"))
}

async function reviewAndSubmit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Review" }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Force close" }))
  })
}

describe("force close", () => {
  it("counted, no variance: sends the count and the reason", async () => {
    const { onDone } = renderDialog()
    await fill({ reason: "Went home ill", counted: "1200" })
    expect(screen.queryByText(/choose a reason/)).not.toBeInTheDocument()
    await reviewAndSubmit()
    expect(sentBody()).toEqual({ reason: "Went home ill", countedCash: 1200 })
    expect(onDone).toHaveBeenCalled()
  })

  it("counted with a variance: the variance reason is required and sent", async () => {
    renderDialog()
    await fill({ reason: "Went home ill", counted: "1180,50" })
    expect(screen.getByRole("button", { name: "Review" })).toBeDisabled()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cash counting error" }))
    })
    await reviewAndSubmit()
    expect(sentBody()).toEqual({ reason: "Went home ill", countedCash: 1180.5, varianceReasonCode: "CASH_COUNTING_ERROR" })
  })

  it("drawer can't be counted: no countedCash is sent", async () => {
    renderDialog()
    await fill({ reason: "Till revoked", cannotCount: true })
    await reviewAndSubmit()
    expect(sentBody()).toEqual({ reason: "Till revoked" })
  })

  it("shows a 400 field error for varianceReasonCode", async () => {
    closeAnswer = () => json(400, { varianceReasonCode: "varianceReasonCode is required when countedCash differs from expected cash (1200.00)." })
    renderDialog()
    await fill({ reason: "x", counted: "1200" })
    await reviewAndSubmit()
    expect(await screen.findByText(/varianceReasonCode is required/)).toBeInTheDocument()
  })

  it("REAUTH_REQUIRED keeps the form (no token) and goes to the password re-sign-in, which brings it back", async () => {
    closeAnswer = () => json(403, { error: "x", code: "REAUTH_REQUIRED" })
    renderDialog()
    await fill({ reason: "Went home ill", counted: "1180" })
    await act(async () => {
      // "Shortage" is THEFT_SUSPECTED, as on the till's close-out.
      fireEvent.click(screen.getByRole("button", { name: "Shortage" }))
    })
    await reviewAndSubmit()

    expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fpos-activity")
    const draft = loadForceCloseDraft()
    expect(draft).toEqual({
      shiftId: 412,
      ownerName: "Thandi Mokoena",
      till: "T1 · Till 1 (front)",
      countedCash: "1180",
      cannotCount: false,
      reason: "Went home ill",
      varianceReasonCode: "THEFT_SUSPECTED",
    })
    expect(JSON.stringify(draft)).not.toMatch(/a\.b\.c|token|password/i)
  })

  it("comes back filled from a draft", async () => {
    renderDialog({
      draft: {
        shiftId: 412,
        ownerName: "Thandi Mokoena",
        till: "T1 · Till 1 (front)",
        countedCash: "",
        cannotCount: true,
        reason: "Till revoked",
        varianceReasonCode: null,
      },
    })
    expect(await screen.findByDisplayValue("Till revoked")).toBeInTheDocument()
    expect(screen.getByLabelText("Drawer can't be counted now")).toBeChecked()
  })

  it("SHIFT_ALREADY_CLOSED says so and reloads the lists", async () => {
    closeAnswer = () => json(409, { error: "x", code: "SHIFT_ALREADY_CLOSED" })
    const onStale = vi.fn()
    renderDialog({ onStale })
    await fill({ reason: "x", cannotCount: true })
    await reviewAndSubmit()
    expect(await screen.findByText("This shift is already closed.")).toBeInTheDocument()
    expect(onStale).toHaveBeenCalled()
  })
})
