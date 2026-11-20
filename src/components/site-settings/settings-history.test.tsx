// T0-4b: the change history: who, when (SAST), setting, old and new value by type, the setting filter and paging.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SettingsHistory, historyQueryFromSearch } from "@/components/site-settings/settings-history"
import { settingsBody } from "@/lib/site-settings.test-fixtures"

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ authFetch }) }))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const vatChange = {
  id: 43,
  key: "vat.standard-rate",
  action: "SET",
  oldValue: 0.15,
  oldIsDefault: true,
  newValue: 0.155,
  newIsDefault: false,
  changedAt: "2026-11-19T08:15:00Z",
  changedById: 1,
  changedByName: "Canteen Admin",
}
const idleReset = {
  id: 42,
  key: "pos.session.idle-expiry-minutes",
  action: "RESET",
  oldValue: 45,
  oldIsDefault: false,
  newValue: 30,
  newIsDefault: true,
  changedAt: "2026-11-18T14:00:00Z",
  changedById: 7,
  changedByName: "Former Manager",
}

let totalElements: number
const historyCalls = () => authFetch.mock.calls.map(([path]) => path)

beforeEach(() => {
  window.history.replaceState(null, "", "/site-settings?tab=history")
  totalElements = 2
  authFetch.mockReset()
  authFetch.mockImplementation(async (path) => {
    const params = new URL(path, "http://x").searchParams
    const size = Number(params.get("size"))
    const page = Number(params.get("page"))
    const content = params.get("key") === "vat.standard-rate" ? [vatChange] : [vatChange, idleReset]
    return json({ content, page, size, totalElements, totalPages: Math.ceil(totalElements / size) })
  })
})

const settings = settingsBody().settings

describe("Change history", () => {
  it("lists who, when (SAST), setting, change, and old and new values formatted by type", async () => {
    render(<SettingsHistory settings={settings} />)
    const rows = await screen.findAllByTestId("history-row")
    expect(historyCalls()[0]).toBe("/admin/settings/history?page=0&size=50")

    const vat = within(rows[0]).getAllByRole("cell").map((cell) => cell.textContent)
    expect(vat[0]).toMatch(/19 Nov 2026.*10:15/) // 08:15Z is 10:15 SAST
    expect(vat.slice(1)).toEqual(["Canteen Admin", "VAT rate", "Changed", "15.00 % (default)", "15.50 %"])

    const reset = within(rows[1]).getAllByRole("cell").map((cell) => cell.textContent)
    expect(reset.slice(1)).toEqual(["Former Manager", "End an idle session after", "Reset to default", "45 minutes", "30 minutes (default)"])
    expect(screen.getByText("2 changes · page 1 of 1")).toBeInTheDocument()
  })

  it("filters by one setting, and keeps the filter in the URL", async () => {
    render(<SettingsHistory settings={settings} />)
    await screen.findAllByTestId("history-row")
    fireEvent.change(screen.getByLabelText("Setting"), { target: { value: "vat.standard-rate" } })
    await waitFor(() => expect(historyCalls()).toContain("/admin/settings/history?key=vat.standard-rate&page=0&size=50"))
    await waitFor(() => expect(screen.getAllByTestId("history-row")).toHaveLength(1))
    expect(window.location.search).toBe("?tab=history&key=vat.standard-rate")
  })

  it("pages through, and a new page size starts from the first page", async () => {
    totalElements = 120
    render(<SettingsHistory settings={settings} />)
    await screen.findByText("120 changes · page 1 of 3")
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    await screen.findByText("120 changes · page 2 of 3")
    expect(historyCalls()).toContain("/admin/settings/history?page=1&size=50")
    expect(window.location.search).toBe("?tab=history&page=1")

    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "200" } })
    await screen.findByText("120 changes · page 1 of 1")
    expect(historyCalls()).toContain("/admin/settings/history?page=0&size=200")
  })

  it("starts from the filter and page in the URL", async () => {
    window.history.replaceState(null, "", "/site-settings?tab=history&key=vat.standard-rate&page=2&size=100")
    expect(historyQueryFromSearch(window.location.search)).toEqual({ key: "vat.standard-rate", page: 2, size: 100 })
    render(<SettingsHistory settings={settings} />)
    await waitFor(() => expect(historyCalls()[0]).toBe("/admin/settings/history?key=vat.standard-rate&page=2&size=100"))
    expect(historyQueryFromSearch("?size=999&page=-3")).toEqual({ key: null, page: 0, size: 50 })
  })

  it("says when there is nothing yet", async () => {
    totalElements = 0
    authFetch.mockImplementation(async () => json({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 }))
    render(<SettingsHistory settings={settings} />)
    expect(await screen.findByText("No settings have been changed yet.")).toBeInTheDocument()
  })
})
