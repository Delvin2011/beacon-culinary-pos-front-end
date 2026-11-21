// T0-5d: the Stock locations page: the list with summary and assignments, add, rename, reorder (both PUTs, the
// second failing, equal sort orders), activate, the maximum, deactivate refused for each reason and several at
// once, and ADMIN only.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StockLocationsPage from "@/app/stock-locations/page"
import type { AdminLocation } from "@/lib/locations"
import { COFFEE, PRIMARY, PRODUCTION, adminLocation, adminLocations, assignments, errorResponse, jsonResponse } from "@/lib/locations.test-fixtures"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => "/stock-locations" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
const toast = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }))

let role: string
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { name: "Ayanda", role }, authFetch }),
}))

let locations: AdminLocation[]
let answer: (path: string, method: string, body: Record<string, unknown> | null) => Response | null

const calls = (method: string, prefix = "/admin/locations") =>
  authFetch.mock.calls.filter(([path, init]) => (init?.method ?? "GET") === method && path.startsWith(prefix))
const bodyOf = (call: [string, RequestInit?]) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>
const row = (id: number) => screen.getByTestId(`location-${id}`)
const dialog = () => screen.getByRole("dialog")

beforeEach(() => {
  replace.mockReset()
  toast.mockReset()
  role = "ADMIN"
  locations = adminLocations()
  answer = () => null
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    const custom = answer(path, method, body)
    if (custom) return custom
    if (path === "/admin/locations" && method === "GET") return jsonResponse(locations)
    if (path === "/admin/locations" && method === "POST") {
      const created = adminLocation({ id: 12, name: String(body?.name), sortOrder: 50 })
      locations = [...locations, created]
      return jsonResponse(created, 201)
    }
    if (path === "/admin/locations/assignments") return jsonResponse(assignments())
    if (path.startsWith("/admin/locations/history")) return jsonResponse({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
    const put = path.match(/^\/admin\/locations\/(\d+)$/)
    if (put && method === "PUT") {
      locations = locations.map((l) => (l.id === Number(put[1]) ? { ...l, name: String(body?.name), ...(body?.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}) } : l))
      return jsonResponse(locations.find((l) => l.id === Number(put[1])))
    }
    const status = path.match(/^\/admin\/locations\/(\d+)\/(deactivate|activate)$/)
    if (status && method === "POST") {
      locations = locations.map((l) => (l.id === Number(status[1]) ? { ...l, active: status[2] === "activate" } : l))
      return jsonResponse(locations.find((l) => l.id === Number(status[1])))
    }
    return jsonResponse({}, 404)
  })
  window.history.replaceState(null, "", "/stock-locations")
})

describe("the list", () => {
  it("shows every location in display order with kind, status, stock summary and assignments", async () => {
    render(<StockLocationsPage />)
    await screen.findByTestId(`location-${PRIMARY.id}`)
    const ids = screen.getAllByTestId(/^location-\d+$/).map((el) => el.getAttribute("data-testid"))
    expect(ids).toEqual([`location-${PRIMARY.id}`, `location-${PRODUCTION.id}`, `location-${COFFEE.id}`, "location-9"])

    expect(within(row(PRIMARY.id)).getByText("Primary")).toBeInTheDocument()
    expect(within(row(PRIMARY.id)).getByText("Always active")).toBeInTheDocument()
    expect(within(row(PRIMARY.id)).queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument()
    expect(within(row(PRODUCTION.id)).getByText("41 ingredients in stock, 2 below zero")).toBeInTheDocument()
    expect(within(row(PRODUCTION.id)).getByText("Production, Bar station, Kitchen station, Handed over at the till")).toBeInTheDocument()
    expect(within(row(COFFEE.id)).getByText("1 ingredient in stock")).toBeInTheDocument()
    expect(row(9)).toHaveAttribute("data-inactive", "true")
    expect(within(row(9)).getByText("Inactive")).toBeInTheDocument()
  })
})

describe("add and rename", () => {
  it("adds a secondary location and reloads", async () => {
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Add location" }))
    fireEvent.change(within(dialog()).getByLabelText("Name"), { target: { value: "  Pastry Room " } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add location" }))
    await waitFor(() => expect(calls("POST")).toHaveLength(1))
    expect(bodyOf(calls("POST")[0])).toEqual({ name: "Pastry Room" })
    expect(await screen.findByTestId("location-12")).toHaveTextContent("Pastry Room")
    expect(toast).toHaveBeenCalledWith({ title: "Pastry Room added" })
  })

  it("checks the name before sending", async () => {
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Add location" }))
    fireEvent.change(within(dialog()).getByLabelText("Name"), { target: { value: "x".repeat(51) } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add location" }))
    expect(await within(dialog()).findByText("At most 50 characters.")).toBeInTheDocument()
    expect(calls("POST")).toHaveLength(0)
  })

  it("renames the primary, and shows LOCATION_INVALID next to the field and LOCATION_NAME_TAKEN above it", async () => {
    let attempt = 0
    answer = (path, method) => {
      if (path !== `/admin/locations/${PRIMARY.id}` || method !== "PUT") return null
      attempt += 1
      if (attempt === 1) return errorResponse(400, "LOCATION_INVALID", { fields: { name: "Name can't contain only symbols." } })
      if (attempt === 2) return errorResponse(409, "LOCATION_NAME_TAKEN", { locationId: COFFEE.id, name: COFFEE.name })
      return null
    }
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: `Rename ${PRIMARY.name}` }))
    const input = within(dialog()).getByLabelText("Name")
    expect(input).toHaveValue(PRIMARY.name)

    fireEvent.change(input, { target: { value: "###" } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }))
    expect(await within(dialog()).findByText("Name can't contain only symbols.")).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "coffee station" } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }))
    expect(await within(dialog()).findByText(`Another active location is already called ${COFFEE.name}.`)).toBeInTheDocument()

    fireEvent.change(input, { target: { value: "Receiving Store" } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(within(row(PRIMARY.id)).getByText("Receiving Store")).toBeInTheDocument())
    expect(bodyOf(calls("PUT").at(-1)!)).toEqual({ name: "Receiving Store" })
  })

  it("explains the maximum on create, with the setting to change", async () => {
    answer = (path, method) => (path === "/admin/locations" && method === "POST" ? errorResponse(409, "LOCATION_LIMIT_REACHED", { maxActive: 3, active: 3 }) : null)
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Add location" }))
    fireEvent.change(within(dialog()).getByLabelText("Name"), { target: { value: "Pastry Room" } })
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add location" }))
    expect(await within(dialog()).findByText("This site can have at most 3 active locations, the primary included. Deactivate one first.")).toBeInTheDocument()
    expect(within(dialog()).getByRole("link", { name: "Admin → Settings" })).toHaveAttribute("href", "/site-settings")
  })
})

describe("reorder", () => {
  it("swaps two rows with two PUTs, the moved row first, then reloads", async () => {
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: `Move ${COFFEE.name} up` }))
    await waitFor(() => expect(calls("PUT")).toHaveLength(2))
    expect(calls("PUT").map((c) => [c[0], bodyOf(c)])).toEqual([
      [`/admin/locations/${COFFEE.id}`, { name: COFFEE.name, sortOrder: 20 }],
      [`/admin/locations/${PRODUCTION.id}`, { name: PRODUCTION.name, sortOrder: 30 }],
    ])
    await waitFor(() => {
      const ids = screen.getAllByTestId(/^location-\d+$/).map((el) => el.getAttribute("data-testid"))
      expect(ids.slice(0, 3)).toEqual([`location-${PRIMARY.id}`, `location-${COFFEE.id}`, `location-${PRODUCTION.id}`])
    })
  })

  it("says so when the second PUT fails, and reloads", async () => {
    answer = (path, method) =>
      path === `/admin/locations/${PRODUCTION.id}` && method === "PUT" ? errorResponse(400, "LOCATION_INVALID", { fields: { sortOrder: "Too high." } }, "sortOrder must be 0–9999.") : null
    render(<StockLocationsPage />)
    await screen.findByTestId(`location-${COFFEE.id}`)
    const getsBefore = calls("GET").filter((c) => c[0] === "/admin/locations").length
    fireEvent.click(screen.getByRole("button", { name: `Move ${COFFEE.name} up` }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `The move was only half done: ${COFFEE.name} moved, but ${PRODUCTION.name} didn't (sortOrder must be 0–9999.).`,
    )
    expect(calls("GET").filter((c) => c[0] === "/admin/locations").length).toBe(getsBefore + 1)
  })

  it("sends one PUT when the two sort orders are equal", async () => {
    locations = locations.map((l) => (l.id === COFFEE.id ? { ...l, sortOrder: 20 } : l))
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: `Move ${COFFEE.name} up` }))
    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    expect(bodyOf(calls("PUT")[0])).toEqual({ name: COFFEE.name, sortOrder: 19 })
  })
})

describe("deactivate and activate", () => {
  const refuse = (details: Record<string, unknown>) => {
    answer = (path, method) => (path.endsWith("/deactivate") && method === "POST" ? errorResponse(409, "LOCATION_DEACTIVATE_REFUSED", details) : null)
  }
  const deactivate = async (name: string) => {
    fireEvent.click(await screen.findByRole("button", { name: `Deactivate ${name}` }))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Deactivate" }))
    return within(await screen.findByTestId("deactivate-refused"))
  }

  it("deactivates after a confirmation", async () => {
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: `Deactivate ${COFFEE.name}` }))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Deactivate" }))
    await waitFor(() => expect(row(COFFEE.id)).toHaveAttribute("data-inactive", "true"))
    expect(toast).toHaveBeenCalledWith({ title: `${COFFEE.name} deactivated` })
  })

  it("PRIMARY", async () => {
    refuse({ locationId: COFFEE.id, reasons: ["PRIMARY"] })
    render(<StockLocationsPage />)
    expect((await deactivate(COFFEE.name)).getByText("It's the primary location: every delivery is received here.")).toBeInTheDocument()
  })

  it("HAS_STOCK lists the lines and how to clear them", async () => {
    refuse({
      locationId: COFFEE.id,
      reasons: ["HAS_STOCK"],
      ingredientsWithStock: 72,
      stock: [
        { ingredientId: 31, name: "Coffee beans", unit: "KG", quantity: 2.5 },
        { ingredientId: 32, name: "Milk", unit: "LITRE", quantity: -1 },
      ],
    })
    render(<StockLocationsPage />)
    const refused = await deactivate(COFFEE.name)
    expect(refused.getByText("This location still holds stock: 72 ingredients.")).toBeInTheDocument()
    expect(refused.getByText(/^Coffee beans: 2\.5/)).toBeInTheDocument()
    expect(refused.getByText(/^Milk: -1/)).toBeInTheDocument()
    expect(refused.getByText("The 2 largest are shown.")).toBeInTheDocument()
    expect(refused.getByText("To clear it, waste it, or count it to zero with a stock take.")).toBeInTheDocument()
  })

  it("ASSIGNED gives one line per job and links to the assignments", async () => {
    refuse({ locationId: PRODUCTION.id, reasons: ["ASSIGNED"], assignedTo: ["PRODUCTION", "STATION_KITCHEN", "STATION_BAR", "STATION_NONE"] })
    render(<StockLocationsPage />)
    const refused = await deactivate(PRODUCTION.name)
    for (const line of ["It's the production location.", "It supplies the kitchen station.", "It supplies the bar station.", "It supplies items handed over at the till."]) {
      expect(refused.getByText(line)).toBeInTheDocument()
    }
    expect(refused.getByRole("link", { name: "Change the assignments" })).toHaveAttribute("href", "#location-assignments")
  })

  it("OPEN_STOCK_REQUESTS and OPEN_STOCK_TAKES link each one", async () => {
    refuse({ locationId: COFFEE.id, reasons: ["OPEN_STOCK_REQUESTS"], openStockRequestIds: [118, 119] })
    render(<StockLocationsPage />)
    let refused = await deactivate(COFFEE.name)
    expect(refused.getByRole("link", { name: "#118" })).toHaveAttribute("href", "/inventory/stock-requests/118")
    expect(refused.getByRole("link", { name: "#119" })).toHaveAttribute("href", "/inventory/stock-requests/119")
    // The footer's Close (the dialog's own X is also called Close).
    fireEvent.click(within(dialog()).getAllByRole("button", { name: "Close" })[0])

    refuse({ locationId: COFFEE.id, reasons: ["OPEN_STOCK_TAKES"], openStockTakeIds: [5] })
    refused = await deactivate(COFFEE.name)
    expect(refused.getByText(/It has stock takes waiting for review/)).toBeInTheDocument()
    expect(refused.getByRole("link", { name: "#5" })).toHaveAttribute("href", "/inventory/stock-takes/5")
  })

  it("shows every reason at once, in the server's order", async () => {
    refuse({
      locationId: PRODUCTION.id,
      reasons: ["HAS_STOCK", "ASSIGNED", "OPEN_STOCK_REQUESTS", "OPEN_STOCK_TAKES"],
      ingredientsWithStock: 1,
      stock: [{ ingredientId: 1, name: "Flour", unit: "KG", quantity: 3 }],
      assignedTo: ["PRODUCTION"],
      openStockRequestIds: [118],
      openStockTakeIds: [5],
    })
    render(<StockLocationsPage />)
    const refused = await deactivate(PRODUCTION.name)
    expect(refused.getAllByRole("listitem").filter((li) => li.hasAttribute("data-reason")).map((li) => li.getAttribute("data-reason"))).toEqual([
      "HAS_STOCK",
      "ASSIGNED",
      "OPEN_STOCK_REQUESTS",
      "OPEN_STOCK_TAKES",
    ])
    expect(row(PRODUCTION.id)).not.toHaveAttribute("data-inactive")
  })

  it("activates, and explains the maximum and a taken name", async () => {
    let attempt = 0
    answer = (path, method) => {
      if (!path.endsWith("/9/activate") || method !== "POST") return null
      attempt += 1
      if (attempt === 1) return errorResponse(409, "LOCATION_LIMIT_REACHED", { maxActive: 3, active: 3 })
      if (attempt === 2) return errorResponse(409, "LOCATION_NAME_TAKEN", { locationId: COFFEE.id, name: "Old Pantry" })
      return null
    }
    render(<StockLocationsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Activate Old Pantry" }))
    fireEvent.click(within(dialog()).getByRole("button", { name: "Activate" }))
    expect(await within(dialog()).findByText("This site can have at most 3 active locations, the primary included. Deactivate one first.")).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Activate" }))
    expect(await within(dialog()).findByText("Another active location is already called Old Pantry.")).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole("button", { name: "Activate" }))
    await waitFor(() => expect(row(9)).not.toHaveAttribute("data-inactive"))
  })
})

describe("access", () => {
  it("sends a STOCK_ADMIN to their own landing page and asks nothing", async () => {
    role = "STOCK_ADMIN"
    render(<StockLocationsPage />)
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(screen.queryByText("Stock locations")).not.toBeInTheDocument()
    expect(calls("GET")).toHaveLength(0)
  })

  it("explains a 403 from the server", async () => {
    answer = (path, method) => (path === "/admin/locations" && method === "GET" ? new Response(null, { status: 403 }) : null)
    render(<StockLocationsPage />)
    expect(await screen.findByText("You don't have permission to manage stock locations. Only an admin can.")).toBeInTheDocument()
  })
})
