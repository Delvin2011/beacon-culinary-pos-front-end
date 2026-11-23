// Confirm sends a frozen body with a clientOrderId; the till is locked until the server gives a definite answer.
import { useContext, type ContextType } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthContext, AuthProvider } from "@/contexts/auth-context"
import { ConnectionProvider } from "@/contexts/connection-context"
import { PosOrderBuilder } from "@/components/pos/order-builder"
import { createPendingSale, loadPendingSale, savePendingSale } from "@/lib/pending-sale"

vi.mock("@/hooks/use-shift", () => ({
  useShift: () => ({
    shift: { id: 7, owner: { id: 1, name: "Me" }, openedAt: "2026-11-16T06:00:00Z", openingFloat: 0, ownedByCaller: true },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

const fetchMock = vi.fn<typeof fetch>()
const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })

const toastie = {
  id: 501,
  mealPeriodId: 1,
  optionDate: "2026-11-16",
  name: "Cheese Toastie",
  price: 40,
  plannedPortions: null,
  portionsRemaining: null,
  group: "LIGHT_MEALS",
}
const order = {
  id: 55,
  orderNumber: 1042,
  status: "PENDING",
  lines: [],
  payments: [{ id: 901, method: "CARD", amount: 40 }],
  stations: [],
}

// What POST /orders answers, one entry per call; the last one repeats.
let orderAnswers: Array<() => Response | Promise<Response>> = []
const orderPosts = () => fetchMock.mock.calls.filter(([input, init]) => String(input).endsWith("/orders") && init?.method === "POST")
const postedBodies = () => orderPosts().map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
const receiptLoads = () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/orders/55"))

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "me@x.co", name: "Me", role: "CASHIER" } }))
  orderAnswers = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^(?:https?:\/\/[^/]+)?\/api(?=\/)/, "")
    if (path === "/orders" && init?.method === "POST") {
      const answer = orderAnswers.length > 1 ? orderAnswers.shift()! : orderAnswers[0]
      return answer ? answer() : new Promise<Response>(() => {})
    }
    if (path === "/health") return new Response(null, { status: 404 })
    if (path === "/meal-periods") return ok([{ id: 1, name: "Lunch", startTime: "00:00:00", endTime: "23:59:59", plannable: false }])
    if (path.startsWith("/menu/today")) return ok({ options: [toastie], availableExtras: [] })
    if (path === "/orders/55") return ok(order)
    if (path.startsWith("/orders/today") || path.startsWith("/accounts")) return ok([])
    return ok({})
  })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTill() {
  return render(
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
}

async function ringUpToastieByCard() {
  const item = await screen.findByText("Cheese Toastie")
  await act(async () => {
    fireEvent.click(item)
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Charge" }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Card" }))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm Payment" }))
  })
}

describe("Confirm", () => {
  it("sends a clientOrderId and locks the till while the sale is checked", async () => {
    renderTill()
    await ringUpToastieByCard()

    expect(postedBodies()).toHaveLength(1)
    expect(postedBodies()[0].clientOrderId).toEqual(expect.any(String))
    const dialog = screen.getByRole("alertdialog")
    expect(dialog).toHaveTextContent("Checking the sale…")
    expect(dialog).toHaveTextContent("1 × Cheese Toastie")
    expect(loadPendingSale()?.clientOrderId).toBe(postedBodies()[0].clientOrderId)
    expect(screen.getByRole("button", { name: "Processing..." })).toBeDisabled()
  })

  it("retries a network error with the same id, and a 200 replay completes the sale once", async () => {
    orderAnswers = [
      () => {
        throw new TypeError("Failed to fetch")
      },
      () => ok(order, 200, { "Idempotent-Replay": "true" }),
    ]
    renderTill()
    await ringUpToastieByCard()

    expect(await screen.findByText("#1042", {}, { timeout: 4_000 })).toBeInTheDocument()
    expect(screen.getByText("This sale had already gone through. It was recorded once.")).toBeInTheDocument()
    const [first, second] = postedBodies()
    expect(second).toEqual(first)
    expect(receiptLoads()).toHaveLength(1)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument()
  })

  it("keeps the cart when the server refuses the sale (NO_OPEN_SHIFT)", async () => {
    orderAnswers = [() => ok({ code: "NO_OPEN_SHIFT", error: "No open shift." }, 409)]
    renderTill()
    await ringUpToastieByCard()

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(screen.getAllByText("Cheese Toastie").length).toBeGreaterThan(1) // menu tile and cart line
    expect(loadPendingSale()).toBeNull()
  })
})

describe("after a reload", () => {
  it("resends the stored sale with the same id and body, and lists it while checking", async () => {
    const stored = createPendingSale(
      "SALE",
      { lines: [{ dailyMealOptionId: 501, quantity: 2, extras: [] }], payments: [{ method: "CARD", amount: 80 }] },
      { lines: [{ name: "Cheese Toastie", quantity: 2 }], total: 80 },
      { key: "email:me@x.co", name: "Me" },
    )
    savePendingSale(stored)
    renderTill()

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("2 × Cheese Toastie")
    await waitFor(() => expect(postedBodies()).toHaveLength(1))
    expect(postedBodies()[0]).toEqual(stored.body)
  })
})

// O2: a session can end while a sale is out. The sale stays pending and goes out again, unchanged, after sign-in.
describe("O2: sessions and pending sales", () => {
  const storedSale = (ownerKey: string, ownerName: string) => {
    const sale = createPendingSale(
      "SALE",
      { lines: [{ dailyMealOptionId: 501, quantity: 1, extras: [] }], payments: [{ method: "CARD", amount: 40 }] },
      { lines: [{ name: "Cheese Toastie", quantity: 1 }], total: 40 },
      { key: ownerKey, name: ownerName },
    )
    savePendingSale(sale)
    return sale
  }

  let auth: ContextType<typeof AuthContext>
  function AuthProbe() {
    auth = useContext(AuthContext)
    return null
  }

  function renderTillWithProbe() {
    return render(
      <AuthProvider>
        <AuthProbe />
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
  }

  it("SESSION_ENDED mid-sale: after signing in again the same clientOrderId is resent and a replay completes it", async () => {
    orderAnswers = [
      () => ok({ error: "x", code: "SESSION_ENDED", details: { reason: "REPLACED" } }, 401),
      () => ok(order, 200, { "Idempotent-Replay": "true" }),
    ]
    renderTillWithProbe()
    await ringUpToastieByCard()

    await waitFor(() => expect(auth?.isAuthenticated).toBe(false))
    const sentId = postedBodies()[0].clientOrderId
    expect(loadPendingSale()?.clientOrderId).toBe(sentId)

    fetchMock.mockImplementationOnce(async () => ok({ token: "n.e.w", user: { email: "me@x.co", name: "Me" } }))
    await act(async () => {
      await auth?.login({ email: "me@x.co", password: "secret1" })
    })

    expect(await screen.findByText("#1042")).toBeInTheDocument()
    expect(postedBodies()).toHaveLength(2)
    expect(postedBodies()[1]).toEqual(postedBodies()[0])
    expect(loadPendingSale()).toBeNull()
  })

  it("a manager can finish another cashier's sale after confirming: the identical body is sent", async () => {
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", name: "Boss", role: "ADMIN" } }))
    const stored = storedSale("cashier:17", "Thandi")
    orderAnswers = [() => ok(order, 200, { "Idempotent-Replay": "true" })]
    renderTill()

    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("A sale by Thandi is still being checked")
    expect(postedBodies()).toHaveLength(0)

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Manager: finish this sale" }))
    })
    expect(postedBodies()).toHaveLength(0)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send it" }))
    })

    expect(await screen.findByText("#1042")).toBeInTheDocument()
    expect(postedBodies()).toEqual([stored.body])
  })

  it("a cashier who isn't the owner can't send it", async () => {
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "sipho@x.co", name: "Sipho", role: "CASHIER" } }))
    storedSale("cashier:17", "Thandi")
    renderTill()

    expect(await screen.findByRole("alertdialog")).toHaveTextContent("A sale by Thandi is still being checked")
    expect(screen.queryByRole("button", { name: /Manager: finish/ })).not.toBeInTheDocument()
    expect(postedBodies()).toHaveLength(0)
  })
})
