// T1-3: the full-page message for a suspended customer, its "Try again" and automatic recovery, and the shared banner
// for an unavailable customer (away from the POS) and an unknown address.
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CustomerStatusGate } from "@/components/customer/customer-status-gate"
import { markUnknownAddress, noteCustomerAnswer, SUSPENDED_MESSAGE, UNKNOWN_ADDRESS_MESSAGE } from "@/lib/customer-status"

let pathname = "/dashboard"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const suspended = () => json(503, { error: "Suspended.", code: "CUSTOMER_SUSPENDED" })
const fetchMock = vi.fn<typeof fetch>()
const paths = () => fetchMock.mock.calls.map(([url]) => String(url))

function renderGate() {
  return render(
    <CustomerStatusGate>
      <main>
        <button type="button">A screen&apos;s button</button>
        <input aria-label="Cart note" defaultValue="2 x Beef stew" />
      </main>
    </CustomerStatusGate>,
  )
}

const suspend = () => act(async () => {
  await noteCustomerAnswer(suspended())
})
const advance = (ms: number) => act(async () => {
  await vi.advanceTimersByTimeAsync(ms)
})

beforeEach(() => {
  pathname = "/dashboard"
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("suspended", () => {
  it("covers the screen with the message and Try again; the screen stays mounted, out of reach", async () => {
    renderGate()
    fireEvent.change(screen.getByLabelText("Cart note"), { target: { value: "3 x Beef stew" } })
    await suspend()

    const dialog = screen.getByRole("alertdialog", { name: "Service unavailable" })
    expect(dialog).toHaveTextContent(SUSPENDED_MESSAGE)
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument()
    const app = document.querySelector("main")!.parentElement!
    expect(app).toHaveAttribute("inert")
    expect(app).toHaveAttribute("aria-hidden", "true")
    // Nothing on the screen was lost.
    expect((screen.getByLabelText("Cart note", { selector: "input" }) as HTMLInputElement).value).toBe("3 x Beef stew")
  })

  it("is on every screen, the POS included", async () => {
    for (const path of ["/pos", "/kitchen", "/bar", "/board", "/invite", "/dashboard"]) {
      pathname = path
      const { unmount } = renderGate()
      await suspend()
      expect(screen.getByRole("alertdialog")).toHaveTextContent(SUSPENDED_MESSAGE)
      unmount()
      await act(async () => {
        await noteCustomerAnswer(json(200, {}))
      })
    }
  })

  it("Try again checks /health at once; still suspended keeps the message", async () => {
    renderGate()
    await suspend()
    fetchMock.mockResolvedValue(suspended())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    expect(paths()).toEqual(["/api/health"])
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()

    fetchMock.mockResolvedValue(json(200, { status: "UP" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(document.querySelector("main")!.parentElement).not.toHaveAttribute("inert")
  })

  it("recovers on its own: one /health check every 60 s ± 15 s, and nothing else is called", async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    fetchMock.mockImplementation(async () => suspended())
    renderGate()
    await suspend()

    await advance(59_000)
    expect(paths()).toEqual([])
    await advance(1_000)
    expect(paths()).toEqual(["/api/health"])
    await advance(120_000)
    expect(paths()).toEqual(["/api/health", "/api/health", "/api/health"])
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()

    fetchMock.mockImplementation(async () => json(200, { status: "UP" }))
    await advance(60_000)
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await advance(10 * 60_000)
    expect(paths()).toHaveLength(4)
  })
})

describe("the banner", () => {
  it("shows CUSTOMER_UNAVAILABLE on a back-office screen with the usual wording", async () => {
    renderGate()
    await act(async () => {
      await noteCustomerAnswer(json(503, { code: "CUSTOMER_UNAVAILABLE" }))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the server. Nothing has been lost. Try again.")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("leaves CUSTOMER_UNAVAILABLE to the POS's own indicator", async () => {
    pathname = "/pos"
    renderGate()
    await act(async () => {
      await noteCustomerAnswer(json(503, { code: "CUSTOMER_UNAVAILABLE" }))
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows an unknown address on any screen, the POS included", async () => {
    for (const path of ["/dashboard", "/pos", "/kitchen", "/board", "/invite"]) {
      pathname = path
      const { unmount } = renderGate()
      act(() => markUnknownAddress())
      expect(screen.getByRole("alert")).toHaveTextContent(UNKNOWN_ADDRESS_MESSAGE)
      unmount()
      await act(async () => {
        await noteCustomerAnswer(json(200, {}))
      })
    }
  })

  it("goes once the server answers normally", async () => {
    renderGate()
    await act(async () => {
      await noteCustomerAnswer(json(503, { code: "CUSTOMER_UNAVAILABLE" }))
    })
    fetchMock.mockResolvedValue(json(200, { status: "UP" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    })
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
