// O4 task 9: the Sale exceptions page: defaults, filters, paging, resolve, approve an account charge, the 409s, ADMIN only.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SaleExceptionsPage from "@/app/sale-exceptions/page"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => "/sale-exceptions" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

let role: string
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { name: "Ayanda", role }, authFetch }),
}))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const oversold = {
  id: 311,
  code: "OVERSOLD",
  severity: "REVIEW",
  status: "OPEN",
  tradingDay: "2026-11-18",
  tillCode: "T1",
  deviceId: "dev-1",
  order: { id: 9302, receiptNumber: "T1-20261118-0008", collectionNumber: "T1-8", soldAt: "2026-11-18T10:51:40Z", total: 85, cashierName: "Thandi Mokoena" },
  detail: { optionId: 801, requested: 2, shortfall: 1 },
  createdAt: "2026-11-18T13:05:01Z",
}
const accountCharge = { ...oversold, id: 312, code: "ACCOUNT_APPROVAL_PENDING", detail: { accountId: 5, accountNumber: "PM0005", amount: 85 } }
const fullOrder = {
  id: 9302,
  orderNumber: 59,
  receiptNumber: "T1-20261118-0008",
  collectionNumber: "T1-8",
  recordedOffline: true,
  soldAt: "2026-11-18T10:51:40Z",
  bookedTradingDay: null,
  total: 85,
  lines: [{ id: 1, name: "Beef stew", quantity: 1, lineTotal: 85, station: "KITCHEN" }],
  payments: [{ id: 1, method: "CASH", amount: 85 }],
}

let listItems: unknown[]
let totalItems: number
let actionAnswer: (path: string, init?: RequestInit) => Response

beforeEach(() => {
  replace.mockReset()
  role = "ADMIN"
  listItems = [oversold, accountCharge]
  totalItems = 2
  actionAnswer = (path) => json({ ...(path.includes("/312/") ? accountCharge : oversold), status: "RESOLVED", resolvedBy: { id: 3, name: "Ayanda" }, order: fullOrder })
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    if (path === "/admin/tills") return json([{ deviceId: "dev-1", tillCode: "T1", tillName: "Till 1 (front)", registered: true, shift: null }])
    if (init?.method === "POST") return actionAnswer(path, init)
    const one = /^\/admin\/sale-exceptions\/(\d+)$/.exec(path)
    if (one) return json({ ...(one[1] === "312" ? accountCharge : oversold), order: fullOrder })
    if (path.startsWith("/admin/sale-exceptions")) return json({ items: listItems, page: 0, size: 50, totalItems })
    return json({})
  })
  window.history.replaceState(null, "", "/sale-exceptions")
})

afterEach(() => {
  vi.clearAllMocks()
})

const listCalls = () => authFetch.mock.calls.map(([path]) => path).filter((path) => path.startsWith("/admin/sale-exceptions?"))

async function openRow(index: number) {
  const rows = await screen.findAllByTestId("exception-row")
  await act(async () => {
    fireEvent.click(within(rows[index]).getByRole("button"))
  })
}

describe("the list", () => {
  it("opens on open REVIEW exceptions, with the sale and its till", async () => {
    render(<SaleExceptionsPage />)
    const rows = await screen.findAllByTestId("exception-row")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("Oversold")
    expect(rows[0]).toHaveTextContent("T1-8")
    expect(rows[0]).toHaveTextContent("Thandi Mokoena")
    expect(rows[0]).toHaveTextContent("R 85.00")
    expect(listCalls()[0]).toBe("/admin/sale-exceptions?status=OPEN&severity=REVIEW&page=0&size=50")
  })

  it("each filter changes the request", async () => {
    render(<SaleExceptionsPage />)
    await screen.findAllByTestId("exception-row")
    await screen.findByRole("option", { name: "T1 · Till 1 (front)" })
    const set = async (label: string, value: string) => {
      await act(async () => {
        fireEvent.change(screen.getByLabelText(label), { target: { value } })
      })
    }
    await set("Status", "RESOLVED")
    await set("Severity", "INFO")
    await set("Type", "OVERSOLD")
    await set("Trading day", "2026-11-18")
    await set("Till", "dev-1")
    await waitFor(() =>
      expect(listCalls().at(-1)).toBe(
        "/admin/sale-exceptions?status=RESOLVED&severity=INFO&code=OVERSOLD&tradingDay=2026-11-18&deviceId=dev-1&page=0&size=50",
      ),
    )
  })

  it("a link can preset the till", async () => {
    window.history.replaceState(null, "", "/sale-exceptions?deviceId=dev-9")
    render(<SaleExceptionsPage />)
    await screen.findAllByTestId("exception-row")
    expect(listCalls()[0]).toContain("deviceId=dev-9")
  })

  it("pages through totalItems, up to 200 a page", async () => {
    totalItems = 120
    render(<SaleExceptionsPage />)
    expect(await screen.findByText(/120 exceptions · Page 1 of 3/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }))
    })
    await waitFor(() => expect(listCalls().at(-1)).toContain("page=1&size=50"))
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Per page"), { target: { value: "200" } })
    })
    await waitFor(() => expect(listCalls().at(-1)).toContain("page=0&size=200"))
    expect(await screen.findByText(/Page 1 of 1/)).toBeInTheDocument()
  })
})

describe("the detail", () => {
  it("shows the detail and the full order, and resolves with a required note", async () => {
    render(<SaleExceptionsPage />)
    await openRow(0)
    expect(await screen.findByText("Shortfall")).toBeInTheDocument()
    const marks = screen.getByTestId("offline-order-marks")
    expect(within(marks).getByText("Offline sale")).toBeInTheDocument()
    expect(within(marks).getByText("Collection T1-8")).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    })
    expect(screen.getByText("Enter a note.")).toBeInTheDocument()
    expect(authFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Note (required)"), { target: { value: "Counted; spare tray." } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    })
    const post = authFetch.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(post[0]).toBe("/admin/sale-exceptions/311/resolve")
    expect(JSON.parse(String(post[1]?.body))).toEqual({ note: "Counted; spare tray." })
    expect(await screen.findByText(/Resolved by Ayanda/)).toBeInTheDocument()
  })

  it("an account charge is approved (note optional), never resolved", async () => {
    render(<SaleExceptionsPage />)
    await openRow(1)
    expect(await screen.findByLabelText("Note (optional)")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve account charge" }))
    })
    const post = authFetch.mock.calls.find(([, init]) => init?.method === "POST")!
    expect(post[0]).toBe("/admin/sale-exceptions/312/approve-account")
    expect(JSON.parse(String(post[1]?.body))).toEqual({})
  })

  it("409 EXCEPTION_ALREADY_RESOLVED says so and shows the server's state", async () => {
    actionAnswer = () => json({ error: "x", code: "EXCEPTION_ALREADY_RESOLVED" }, 409)
    render(<SaleExceptionsPage />)
    await openRow(0)
    await act(async () => {
      fireEvent.change(await screen.findByLabelText("Note (required)"), { target: { value: "Checked." } })
    })
    const detailLoads = () => authFetch.mock.calls.filter(([path]) => path === "/admin/sale-exceptions/311").length
    const before = detailLoads()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    })
    expect(await screen.findByText("This exception has already been resolved.")).toBeInTheDocument()
    expect(detailLoads()).toBe(before + 1)
  })

  it("409 USE_APPROVE_ACCOUNT says to approve instead", async () => {
    actionAnswer = () => json({ error: "x", code: "USE_APPROVE_ACCOUNT" }, 409)
    render(<SaleExceptionsPage />)
    await openRow(0)
    await act(async () => {
      fireEvent.change(await screen.findByLabelText("Note (required)"), { target: { value: "Checked." } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    })
    expect(await screen.findByText(/use Approve account charge instead/)).toBeInTheDocument()
  })

  it("a 400 note error shows under the note", async () => {
    actionAnswer = () => json({ note: "The note can be at most 500 characters." }, 400)
    render(<SaleExceptionsPage />)
    await openRow(0)
    await act(async () => {
      fireEvent.change(await screen.findByLabelText("Note (required)"), { target: { value: "Checked." } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Resolve" }))
    })
    expect(await screen.findByText("The note can be at most 500 characters.")).toBeInTheDocument()
  })
})

describe("access", () => {
  it("is for admins only", async () => {
    role = "CASHIER"
    const { container } = render(<SaleExceptionsPage />)
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"))
    expect(container).toBeEmptyDOMElement()
    expect(listCalls()).toEqual([])
  })
})
