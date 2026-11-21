// T0-5d: the light-meal stock review labels its amounts with the meal's source location (sourceLocationName) and the
// primary (GET /locations, by kind); the batch request goes to sourceLocationId; LOCATION_INACTIVE reloads the review.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StockReviewPanel } from "@/components/catalog/stock-review-panel"
import type { StockReview } from "@/lib/light-meal-stock"
import { COFFEE, PRIMARY, errorResponse, jsonResponse, pickerLocations } from "@/lib/locations.test-fixtures"

const toast = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }))
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
const user = { name: "Lerato", role: "HEAD_CHEF" }
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ authFetch, user }) }))

const review = (overrides: Partial<StockReview> = {}): StockReview => ({
  mealId: 21,
  name: "Toasted sandwich",
  tracked: true,
  status: "OUT",
  unitsAvailable: 0,
  limitingIngredient: "Bread",
  lowStockUnits: 10,
  outToday: false,
  lines: [{ ingredientId: 5, name: "Bread", uom: "LOAF", perUnit: 0.1, kitchenAvailable: 0, mainStoreAvailable: 1, unitsPossible: 0, status: "OUT" }],
  sourceLocationId: COFFEE.id,
  sourceLocationName: COFFEE.name,
  ...overrides,
})

let postAnswer: (() => Response) | null
const reviewGets = () => authFetch.mock.calls.filter(([path]) => path === "/admin/meal-catalog/21/stock-review")
const posts = () => authFetch.mock.calls.filter(([path, init]) => path === "/stock-requests" && init?.method === "POST")

beforeEach(() => {
  toast.mockReset()
  postAnswer = null
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    if (path === "/locations") return jsonResponse(pickerLocations())
    if (path === "/admin/meal-catalog/21/stock-review") return jsonResponse(review())
    if (path === "/stock-requests") return postAnswer ? postAnswer() : jsonResponse({ id: 88 }, 201)
    return jsonResponse({}, 404)
  })
})

const renderPanel = () =>
  render(<StockReviewPanel meal={{ id: 21, name: "Toasted sandwich" }} onOpenChange={vi.fn()} onStockChange={vi.fn()} />)

describe("light-meal stock review", () => {
  it("labels the amounts with the source location and the primary", async () => {
    renderPanel()
    expect(await screen.findByText(`${COFFEE.name} doesn't have enough to make one unit.`)).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: `At ${COFFEE.name}` })).toBeInTheDocument()
    expect(await screen.findByRole("columnheader", { name: PRIMARY.name })).toBeInTheDocument()
  })

  it("sends the batch to the source location, with the same labels in the dialog", async () => {
    renderPanel()
    fireEvent.click((await screen.findAllByRole("button", { name: "Request stock" }))[0])
    const dialog = await screen.findByRole("dialog", { name: "Request stock" })
    expect(within(dialog).getByText(new RegExp(`Issued from ${PRIMARY.name} to ${COFFEE.name}\\.`))).toBeInTheDocument()
    expect(within(dialog).getByRole("columnheader", { name: `At ${COFFEE.name}` })).toBeInTheDocument()
    expect(within(dialog).getByRole("columnheader", { name: PRIMARY.name })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit request" }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({ requestType: "ISSUE", locationId: COFFEE.id })
  })

  it("reloads the review when the source was deactivated meanwhile", async () => {
    postAnswer = () => errorResponse(400, "LOCATION_INACTIVE", { locationId: COFFEE.id, locationName: COFFEE.name })
    renderPanel()
    fireEvent.click((await screen.findAllByRole("button", { name: "Request stock" }))[0])
    const dialog = await screen.findByRole("dialog", { name: "Request stock" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit request" }))
    expect(await within(dialog).findByText(new RegExp(`${COFFEE.name} has been deactivated\\. The stock review has been reloaded`))).toBeInTheDocument()
    await waitFor(() => expect(reviewGets()).toHaveLength(2))
  })
})
