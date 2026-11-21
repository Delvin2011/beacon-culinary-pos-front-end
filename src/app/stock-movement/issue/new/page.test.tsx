// T0-5d: a new ISSUE request: only active secondaries can be chosen, the primary is shown as the supplier ("From
// {primary} to {chosen}"), the only secondary is preselected, locationId is sent, and ISSUE_LOCATION_NOT_SECONDARY,
// LOCATION_INACTIVE and LOCATION_NOT_FOUND reload the picker and ask to choose again.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import StockMovementNewIssuePage from "@/app/stock-movement/issue/new/page"
import type { Location } from "@/lib/locations"
import { COFFEE, PRIMARY, PRODUCTION, errorResponse, jsonResponse, pickerLocations } from "@/lib/locations.test-fixtures"

vi.mock("@/components/ui/select", async () => (await import("@/components/inventory/line-item-sheet.test-fixtures")).selectMock)
vi.mock("@/components/inventory/ingredient-search-select", async () => (await import("@/components/inventory/line-item-sheet.test-fixtures")).ingredientSearchMock)
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
const toast = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }))
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { name: "Sipho", role: "STOCK_CLERK" }, authFetch }),
}))

let locations: Location[]
let postAnswer: (() => Response) | null

const posts = () => authFetch.mock.calls.filter(([path, init]) => path === "/stock-requests" && init?.method === "POST")
const locationGets = () => authFetch.mock.calls.filter(([path]) => path === "/locations")
const picker = () => screen.getByTestId("mock-select") as HTMLSelectElement
const offered = () => within(picker()).getAllByRole("option").filter((o) => (o as HTMLOptionElement).value !== "").map((o) => o.textContent)

beforeEach(() => {
  push.mockReset()
  toast.mockReset()
  locations = pickerLocations()
  postAnswer = null
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    if (path === "/locations") return jsonResponse(locations)
    if (path === "/admin/ingredients") return jsonResponse([{ id: 31, name: "Coffee beans", unit: "KG", active: true }])
    if (path === "/admin/grv") return jsonResponse([])
    if (path === "/stock-requests") return postAnswer ? postAnswer() : jsonResponse({ id: 501 }, 201)
    return jsonResponse({}, 404)
  })
})

async function addLine() {
  fireEvent.change(await screen.findByTestId("ingredient-select"), { target: { value: "31" } })
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "2" } })
}

describe("new ISSUE request", () => {
  it("offers only active secondaries and shows the primary as supplier", async () => {
    render(<StockMovementNewIssuePage />)
    await screen.findByText("Supplied from")
    expect(screen.getByText(PRIMARY.name)).toBeInTheDocument()
    expect(offered()).toEqual([PRODUCTION.name, COFFEE.name])
    // Two secondaries: nothing preselected, the user must choose.
    expect(picker().value).toBe("")
    expect(screen.queryByTestId("location-summary")).not.toBeInTheDocument()

    fireEvent.change(picker(), { target: { value: String(COFFEE.id) } })
    expect(screen.getByTestId("location-summary")).toHaveTextContent(`From ${PRIMARY.name} to ${COFFEE.name}`)
  })

  it("preselects the only active secondary and sends its id", async () => {
    locations = pickerLocations().filter((l) => l.id !== COFFEE.id)
    render(<StockMovementNewIssuePage />)
    await waitFor(() => expect(picker().value).toBe(String(PRODUCTION.id)))
    expect(screen.getByTestId("location-summary")).toHaveTextContent(`From ${PRIMARY.name} to ${PRODUCTION.name}`)
    await addLine()
    fireEvent.click(screen.getByRole("button", { name: "Submit Issue Request" }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({ requestType: "ISSUE", locationId: PRODUCTION.id })
    await waitFor(() => expect(push).toHaveBeenCalledWith("/stock-movement/requests"))
  })

  it("asks for a location before sending", async () => {
    render(<StockMovementNewIssuePage />)
    await addLine()
    fireEvent.click(screen.getByRole("button", { name: "Submit Issue Request" }))
    expect(await screen.findByText("Select a location for every configured location field.")).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })

  it.each([
    ["ISSUE_LOCATION_NOT_SECONDARY", `${COFFEE.name} is the primary location`],
    ["LOCATION_INACTIVE", `${COFFEE.name} has been deactivated.`],
    ["LOCATION_NOT_FOUND", "That location no longer exists."],
  ])("%s reloads the picker and asks to choose again", async (code, text) => {
    postAnswer = () => {
      // The location went away meanwhile: the reload no longer offers it.
      locations = pickerLocations().filter((l) => l.id !== COFFEE.id)
      return errorResponse(400, code, { locationId: COFFEE.id, locationName: COFFEE.name })
    }
    render(<StockMovementNewIssuePage />)
    await screen.findByText("Supplied from")
    fireEvent.change(picker(), { target: { value: String(COFFEE.id) } })
    await addLine()
    fireEvent.click(screen.getByRole("button", { name: "Submit Issue Request" }))
    expect(await screen.findByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toHaveTextContent("choose again.")
    expect(locationGets().length).toBeGreaterThanOrEqual(2)
    await waitFor(() => expect(offered()).toEqual([PRODUCTION.name]))
    // The deactivated choice is cleared, and the lines are kept.
    expect(picker().value).toBe("")
    expect(screen.getByRole("spinbutton")).toHaveValue(2)
    expect(push).not.toHaveBeenCalled()
  })

  it("says so when there is no secondary to issue to", async () => {
    locations = pickerLocations().filter((l) => l.kind === "PRIMARY")
    render(<StockMovementNewIssuePage />)
    expect(await screen.findByText("There is no active location to issue to. An admin can add one under Admin → Stock locations.")).toBeInTheDocument()
  })
})
