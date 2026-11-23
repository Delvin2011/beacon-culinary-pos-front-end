// O2: the POS header names the till and the cashier; Lock till keeps the shift and the cart; the cart comes back
// only for the same person.
import { useContext, useEffect } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { ConnectionProvider } from "@/contexts/connection-context"
import { ShiftProvider } from "@/contexts/shift-context"
import PosMainPage from "@/app/pos/page"
import { PENDING_CART_KEY, loadPendingCart, savePendingCart } from "@/lib/pending-cart"
import { resetLockBlockers } from "@/lib/lock-guard"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }))

const fetchMock = vi.fn<typeof fetch>()
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const toastie = {
  id: 501,
  mealPeriodId: 1,
  optionDate: "2026-11-18",
  name: "Cheese Toastie",
  price: 40,
  plannedPortions: null,
  portionsRemaining: null,
  group: "LIGHT_MEALS",
}
const keptLine = { id: "line-1", dailyMealOptionId: 501, name: "Cheese Toastie", unitPrice: 40, quantity: 2, extras: [], alwaysOn: true }

let tillCode: string | null = "T1"
let orderAnswer: () => Promise<Response> = () => new Promise(() => {})

const thandi = { token: "a.b.c", user: { email: "17", name: "Thandi Mokoena", role: "CASHIER", cashierId: 17 } }
const sipho = { token: "d.e.f", user: { email: "23", name: "Sipho Dlamini", role: "ADMIN", cashierId: 23 } }

beforeEach(() => {
  replace.mockReset()
  resetLockBlockers()
  localStorage.clear()
  sessionStorage.clear()
  tillCode = "T1"
  orderAnswer = () => new Promise(() => {})
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^(?:https?:\/\/[^/]+)?\/api(?=\/)/, "")
    if (path === "/shifts/open") {
      return ok({
        shiftId: 412,
        owner: { id: 17, name: "Thandi Mokoena" },
        ownedByCaller: true,
        openedAt: "2026-11-18T05:58:12Z",
        openingFloat: 500,
        tillCode,
        tillName: tillCode ? "Till 1 (front)" : "Unregistered till",
      })
    }
    if (path === "/orders" && init?.method === "POST") return orderAnswer()
    if (path === "/pos/lock") return new Response(null, { status: 204 })
    if (path === "/health") return new Response(null, { status: 404 })
    if (path === "/meal-periods") return ok([{ id: 1, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: false }])
    if (path.startsWith("/menu/today")) return ok({ options: [toastie], availableExtras: [] })
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

let endSession: (() => Promise<unknown>) | null = null
function SessionProbe() {
  const auth = useContext(AuthContext)
  useEffect(() => {
    endSession = () => auth!.authFetch("/orders/9/mark-print-failed", { method: "POST" })
  })
  return null
}

function renderPos(signedIn: typeof thandi = thandi) {
  localStorage.setItem("bar-talk.auth", JSON.stringify(signedIn))
  return render(
    <AuthProvider>
      <ConnectionProvider>
        <ShiftProvider>
          <SessionProbe />
          <PosMainPage />
        </ShiftProvider>
      </ConnectionProvider>
    </AuthProvider>,
  )
}

async function addToastie() {
  const tile = await screen.findByText("Cheese Toastie")
  await act(async () => {
    fireEvent.click(tile)
  })
}

const posts = (pathEnd: string) => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(pathEnd) && init?.method === "POST")

describe("POS header", () => {
  it("shows the till code and the cashier", async () => {
    renderPos()
    expect(await screen.findByText("T1 · Thandi Mokoena")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Lock till/ })).toBeEnabled()
    expect(screen.getByRole("button", { name: /End shift/ })).toBeEnabled()
  })

  it("says 'Unregistered till' without a till code", async () => {
    tillCode = null
    renderPos()
    expect(await screen.findByText("Unregistered till · Thandi Mokoena")).toBeInTheDocument()
  })
})

describe("Lock till", () => {
  it("keeps the cart and the shift, ends the session and goes to sign-in", async () => {
    renderPos()
    await addToastie()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Lock till/ }))
    })

    expect(posts("/pos/lock")).toHaveLength(1)
    expect(posts("/close")).toHaveLength(0)
    expect(replace).toHaveBeenCalledWith("/pos/login")
    const kept = loadPendingCart<{ name: string; quantity: number }>()
    expect(kept?.owner).toEqual({ key: "cashier:17", name: "Thandi Mokoena" })
    expect(kept?.lines.map((line) => [line.name, line.quantity])).toEqual([["Cheese Toastie", 1]])
  })

  it("is not available while a payment is open, nor while a sale's outcome is unknown", async () => {
    renderPos()
    await addToastie()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Charge" }))
    })
    expect(screen.getByRole("button", { name: /Lock till/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /End shift/ })).toBeDisabled()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Card" }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm Payment" }))
    })
    // The sale is out and never answered: still blocked.
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Checking the sale…")
    expect(screen.getByRole("button", { name: /Lock till/ })).toBeDisabled()
  })

  it("keeps the cart when the server ends the session", async () => {
    renderPos()
    await addToastie()
    fetchMock.mockImplementationOnce(async () =>
      ok({ error: "x", code: "SESSION_ENDED", details: { reason: "IDLE" } }, 401),
    )
    await act(async () => {
      await endSession?.()
    })
    expect(loadPendingCart()?.owner.key).toBe("cashier:17")
  })
})

describe("the kept cart after signing in again", () => {
  it("comes back for the same person", async () => {
    savePendingCart({ key: "cashier:17", name: "Thandi Mokoena" }, [keptLine])
    renderPos()
    await waitFor(() => expect(screen.getAllByText("Cheese Toastie").length).toBeGreaterThan(1)) // tile and cart line
    expect(localStorage.getItem(PENDING_CART_KEY)).toBeNull()
    expect(screen.queryByText(/order was kept/)).not.toBeInTheDocument()
  })

  it("someone else is asked; Keep leaves it stored", async () => {
    savePendingCart({ key: "cashier:17", name: "Thandi Mokoena" }, [keptLine])
    renderPos(sipho)
    expect(await screen.findByText("Thandi Mokoena's order was kept")).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Keep it for Thandi Mokoena" }))
    })
    expect(screen.queryByText(/order was kept/)).not.toBeInTheDocument()
    expect(loadPendingCart()?.owner.key).toBe("cashier:17")
  })

  it("someone else is asked; Discard clears it", async () => {
    savePendingCart({ key: "cashier:17", name: "Thandi Mokoena" }, [keptLine])
    renderPos(sipho)
    await screen.findByText("Thandi Mokoena's order was kept")
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Discard it" }))
    })
    expect(loadPendingCart()).toBeNull()
  })
})
