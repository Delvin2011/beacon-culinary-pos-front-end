// T0-5d: the line item sheet's locations. A GRV shows "Received into {primary}" and offers no choice; WASTE requests,
// waste and stock takes offer every active location, the primary included, in the API's order.
import { render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { LineItemSheet } from "@/components/inventory/line-item-sheet"
import { COFFEE, PRIMARY, PRODUCTION, jsonResponse, pickerLocations } from "@/lib/locations.test-fixtures"

vi.mock("@/components/ui/select", async () => (await import("@/components/inventory/line-item-sheet.test-fixtures")).selectMock)
vi.mock("@/components/inventory/ingredient-search-select", async () => (await import("@/components/inventory/line-item-sheet.test-fixtures")).ingredientSearchMock)
const authFetch = vi.fn<(path: string) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ authFetch }) }))

beforeEach(() => {
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => (path === "/locations" ? jsonResponse(pickerLocations()) : jsonResponse({}, 404)))
})

const columnConfig = { reasonRequirement: "optional" as const, quantityMode: { kind: "single" as const, label: "Qty" }, showLineValue: false }

describe("line item sheet locations", () => {
  it("GRV: received into the primary, no location choice", async () => {
    render(
      <LineItemSheet
        title="GRV"
        requestType="GRV"
        locationCount={0}
        headerInfo={[{ label: "Received into", value: PRIMARY.name }]}
        columnConfig={columnConfig}
        ingredientOptions={[]}
        requestedByName="Thandi"
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByText("Received into")).toBeInTheDocument()
    expect(screen.getByText(PRIMARY.name)).toBeInTheDocument()
    expect(screen.queryByTestId("mock-select")).not.toBeInTheDocument()
  })

  it.each(["WASTE", "WASTE_DIRECT", "STOCK_TAKE"])("%s: every active location, the primary included", async (requestType) => {
    render(
      <LineItemSheet
        title="Sheet"
        requestType={requestType}
        locationCount={1}
        locationLabels={["Location"]}
        columnConfig={columnConfig}
        ingredientOptions={[]}
        requestedByName="Thandi"
        onSubmit={vi.fn()}
      />,
    )
    const picker = screen.getByTestId("mock-select")
    await waitFor(() =>
      expect(
        within(picker)
          .getAllByRole("option")
          .filter((o) => (o as HTMLOptionElement).value !== "")
          .map((o) => o.textContent),
      ).toEqual([PRIMARY.name, PRODUCTION.name, COFFEE.name]),
    )
    expect(authFetch).toHaveBeenCalledWith("/locations")
  })
})
