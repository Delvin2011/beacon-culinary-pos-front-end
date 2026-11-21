// T0-5d: the assignments section: only active secondaries offered, the explanations, save sends only what changed,
// and each error code (ASSIGNMENT_NOT_SECONDARY, LOCATION_INACTIVE, LOCATION_NOT_FOUND reload; LOCATION_INVALID
// nothing to save).
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AssignmentsSection } from "@/components/stock-locations/assignments-section"
import type { LocationAssignments } from "@/lib/locations"
import { COFFEE, PRIMARY, PRODUCTION, adminLocations, assignments, errorResponse, jsonResponse } from "@/lib/locations.test-fixtures"

const toast = vi.fn()
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }))
const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ authFetch }) }))

let stored: LocationAssignments
let putAnswer: ((body: Record<string, unknown>) => Response) | null
const onChanged = vi.fn()

const puts = () => authFetch.mock.calls.filter(([, init]) => init?.method === "PUT")
const gets = () => authFetch.mock.calls.filter(([path, init]) => path === "/admin/locations/assignments" && !init?.method)

beforeEach(() => {
  toast.mockReset()
  onChanged.mockReset()
  stored = assignments()
  putAnswer = null
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    if (path !== "/admin/locations/assignments") return jsonResponse({}, 404)
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { productionLocationId?: number; stations?: Record<string, number> }
      if (putAnswer) return putAnswer(body)
      const name = (id: number) => adminLocations().find((l) => l.id === id)!.name
      if (body.productionLocationId) stored = { ...stored, production: { id: body.productionLocationId, name: name(body.productionLocationId) } }
      for (const [station, id] of Object.entries(body.stations ?? {})) {
        stored = { ...stored, stations: { ...stored.stations, [station]: { id, name: name(id) } } }
      }
      return jsonResponse(stored)
    }
    return jsonResponse(stored)
  })
})

const renderSection = () => render(<AssignmentsSection locations={adminLocations()} onChanged={onChanged} />)

describe("assignments", () => {
  it("offers only active secondaries, with the explanations", async () => {
    renderSection()
    const production = await screen.findByLabelText("Production location")
    const offered = within(production).getAllByRole("option").map((o) => o.textContent)
    // Not the primary, not the inactive "Old Pantry".
    expect(offered).toEqual([PRODUCTION.name, COFFEE.name])
    expect(screen.getByText(`Where the daily planning issue sheet sends ingredients (from ${PRIMARY.name}).`)).toBeInTheDocument()
    for (const label of ["Kitchen station source", "Bar station source", "Handed over at the till station source"]) {
      expect(within(screen.getByLabelText(label)).getAllByRole("option").map((o) => o.textContent)).toEqual([PRODUCTION.name, COFFEE.name])
    }
    expect(screen.getAllByText("Sales at this station take their stock from here.")).toHaveLength(3)
    expect(screen.getAllByText("Bar items and items handed over at the till don't use stock yet; this applies once they do.")).toHaveLength(2)
  })

  it("sends only what changed, then asks the list to reload", async () => {
    renderSection()
    fireEvent.change(await screen.findByLabelText("Bar station source"), { target: { value: String(COFFEE.id) } })
    fireEvent.click(screen.getByRole("button", { name: "Save assignments" }))
    await waitFor(() => expect(puts()).toHaveLength(1))
    expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({ stations: { BAR: COFFEE.id } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Assignments saved" }))
  })

  it("says there is nothing to save without sending", async () => {
    renderSection()
    fireEvent.click(await screen.findByRole("button", { name: "Save assignments" }))
    expect(await screen.findByText("Nothing to save: no assignment was changed.")).toBeInTheDocument()
    expect(puts()).toHaveLength(0)
  })

  it.each([
    ["ASSIGNMENT_NOT_SECONDARY", { role: "PRODUCTION", locationId: PRIMARY.id, locationName: PRIMARY.name }, `${PRIMARY.name} is the primary location`],
    ["LOCATION_INACTIVE", { locationId: COFFEE.id, locationName: COFFEE.name }, `${COFFEE.name} has been deactivated.`],
    ["LOCATION_NOT_FOUND", { locationId: COFFEE.id }, "That location no longer exists."],
  ])("%s reloads the assignments and the list and asks to choose again", async (code, details, text) => {
    putAnswer = () => errorResponse(400, code, details)
    renderSection()
    fireEvent.change(await screen.findByLabelText("Production location"), { target: { value: String(COFFEE.id) } })
    fireEvent.click(screen.getByRole("button", { name: "Save assignments" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(text)
    expect(alert).toHaveTextContent("choose again.")
    await waitFor(() => expect(gets()).toHaveLength(2))
    expect(onChanged).toHaveBeenCalled()
    expect(screen.getByLabelText("Production location")).toHaveValue(String(PRODUCTION.id))
  })

  it("LOCATION_INVALID says there was nothing to save", async () => {
    putAnswer = () => errorResponse(400, "LOCATION_INVALID", { fields: { productionLocationId: "Nothing to change." } })
    renderSection()
    fireEvent.change(await screen.findByLabelText("Kitchen station source"), { target: { value: String(COFFEE.id) } })
    fireEvent.click(screen.getByRole("button", { name: "Save assignments" }))
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing to save: no assignment was changed.")
    expect(gets()).toHaveLength(1)
  })
})
