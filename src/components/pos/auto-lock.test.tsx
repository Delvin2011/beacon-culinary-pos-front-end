// O2 auto-lock: idleLockMinutes without input, a 30 s warning, then Lock till. Postponed while something is busy.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { AutoLock } from "@/components/pos/auto-lock"
import { resetLockBlockers, setLockBlocker } from "@/lib/lock-guard"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))

const fetchMock = vi.fn<typeof fetch>()
const MINUTE = 60_000

const lockCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/pos/lock")).length

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function renderSignedIn(idleLockMinutes = 2) {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "17", name: "Thandi", cashierId: 17 } }))
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("/pos/till-status")) {
      return new Response(
        JSON.stringify({ registered: true, tillCode: "T1", tillName: "Till 1", shift: null, idleLockMinutes, requireRegistered: false }),
        { status: 200 },
      )
    }
    return new Response(null, { status: 204 })
  })
  return render(
    <AuthProvider>
      <AutoLock />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  resetLockBlockers()
  replace.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("auto-lock", () => {
  it("warns after idleLockMinutes, then locks 30 s later", async () => {
    renderSignedIn(2)
    await advance(0)

    await advance(2 * MINUTE - 2_000)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()

    await advance(2_000)
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Locking the till in 30 s")
    expect(lockCalls()).toBe(0)

    await advance(30_000)
    expect(lockCalls()).toBe(1)
    expect(replace).toHaveBeenCalledWith("/pos/login")
  })

  it("input resets the countdown", async () => {
    renderSignedIn(2)
    await advance(0)
    await advance(MINUTE + 30_000)
    fireEvent.pointerDown(window)
    await advance(MINUTE + 30_000)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await advance(30_000)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("'Stay signed in' cancels the lock and starts again", async () => {
    renderSignedIn(2)
    await advance(0)
    await advance(2 * MINUTE)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }))
    })
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await advance(60_000)
    expect(lockCalls()).toBe(0)
  })

  it("waits during a payment or while a sale's outcome is unknown, then counts again from when it finishes", async () => {
    renderSignedIn(2)
    await advance(0)
    act(() => setLockBlocker("payment", true))
    await advance(10 * MINUTE)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(lockCalls()).toBe(0)

    act(() => setLockBlocker("payment", false))
    act(() => setLockBlocker("pending-sale", true))
    await advance(10 * MINUTE)
    expect(lockCalls()).toBe(0)

    act(() => setLockBlocker("pending-sale", false))
    await advance(2 * MINUTE - 2_000)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    // Within one 1 s tick of the 30 s warning ending.
    await advance(2_000 + 31_000)
    expect(lockCalls()).toBe(1)
  })

  it("a dialog opening during the warning cancels it", async () => {
    renderSignedIn(2)
    await advance(0)
    await advance(2 * MINUTE)
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    act(() => setLockBlocker("manager-pin", true))
    await advance(1_000)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await advance(60_000)
    expect(lockCalls()).toBe(0)
  })

  it("does nothing while signed out", async () => {
    render(
      <AuthProvider>
        <AutoLock />
      </AuthProvider>,
    )
    await advance(30 * MINUTE)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
