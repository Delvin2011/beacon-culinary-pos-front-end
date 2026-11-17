// O2 uncounted shifts: a late count, or a sign-off confirming there is no count.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { CashCountDialog, type CashCountTarget } from "@/components/pos-activity/cash-count-dialog"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let answer: () => Response
const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
const lastBody = () => JSON.parse(String(posts().at(-1)?.[1]?.body)) as Record<string, unknown>

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", role: "ADMIN" } }))
  push.mockReset()
  answer = () => json(200, { id: 412 })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => answer())
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderDialog(mode: CashCountTarget["mode"]) {
  const onDone = vi.fn()
  render(
    <AuthProvider>
      <CashCountDialog target={{ shiftId: 412, ownerName: "Thandi", expectedCash: 1200, mode }} onClose={vi.fn()} onDone={onDone} />
    </AuthProvider>,
  )
  return onDone
}

async function press(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }))
  })
}

describe("late count", () => {
  it("records the count and its variance reason", async () => {
    const onDone = renderDialog("count")
    fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: "1195" } })
    expect(screen.getByRole("button", { name: "Record count" })).toBeDisabled()
    await press("Cash counting error")
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Counted next morning." } })
    await press("Record count")

    expect(String(posts()[0][0])).toMatch(/\/admin\/shifts\/412\/count$/)
    expect(lastBody()).toEqual({ countedCash: 1195, varianceReasonCode: "CASH_COUNTING_ERROR", note: "Counted next morning." })
    expect(onDone).toHaveBeenCalled()
  })

  it.each([
    ["SHIFT_NOT_UNCOUNTED", "This shift already has a cash count."],
    ["ALREADY_SIGNED_OFF", "This shift is already signed off, so a count can't be recorded."],
    ["DAY_CLOSED", "This shift's trading day is closed (Z taken), so a count can't be recorded."],
  ])("%s is explained", async (code, message) => {
    answer = () => json(409, { error: "x", code })
    renderDialog("count")
    fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: "1200" } })
    await press("Record count")
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it("REAUTH_REQUIRED goes to the password re-sign-in", async () => {
    answer = () => json(403, { error: "x", code: "REAUTH_REQUIRED" })
    renderDialog("count")
    fireEvent.change(screen.getByLabelText("Counted cash"), { target: { value: "1200" } })
    await press("Record count")
    expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fpos-activity")
  })
})

describe("confirm no count", () => {
  it("needs a note, then signs off with confirmNoCount", async () => {
    const onDone = renderDialog("no-count")
    expect(screen.getByRole("button", { name: "Confirm no count and sign off" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Bag lost in transit." } })
    await press("Confirm no count and sign off")

    expect(String(posts()[0][0])).toMatch(/\/admin\/shifts\/412\/signoff$/)
    expect(lastBody()).toEqual({ note: "Bag lost in transit.", confirmNoCount: true })
    expect(onDone).toHaveBeenCalled()
  })
})
