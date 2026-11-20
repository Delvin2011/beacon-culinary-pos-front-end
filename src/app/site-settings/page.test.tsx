// T0-4b: the Site settings page: groups, default vs changed, reset, save only the changes, 400s under their fields,
// offline settings without the entitlement, ADMIN only.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SiteSettingsPage from "@/app/site-settings/page"
import { settingsBody } from "@/lib/site-settings.test-fixtures"
import type { SiteSettings } from "@/lib/site-settings"

const replace = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/site-settings" }))
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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

let current: SiteSettings
let putAnswer: (body: Record<string, unknown>) => Response
let resetAnswer: (key: string) => Response

const calls = (method: string) => authFetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method)
const putBody = (index = 0) => JSON.parse(String(calls("PUT")[index][1]?.body)) as Record<string, unknown>
const row = (key: string) => screen.getByTestId(`setting-${key}`)
const status = (key: string) => within(row(key)).getByTestId("setting-status").textContent

beforeEach(() => {
  replace.mockReset()
  push.mockReset()
  toast.mockReset()
  sessionStorage.clear()
  role = "ADMIN"
  current = settingsBody({
    "pos.session.idle-expiry-minutes": { value: 45, lastChange: { byName: "Canteen Admin", at: "2026-11-19T08:15:00Z", action: "SET" } },
  })
  putAnswer = () => json(current)
  resetAnswer = () => json(current)
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    if (path === "/admin/settings" && !init?.method) return json(current)
    if (path === "/admin/settings" && init?.method === "PUT") return putAnswer(JSON.parse(String(init.body)))
    const reset = path.match(/^\/admin\/settings\/(.+)\/reset$/)
    if (reset && init?.method === "POST") return resetAnswer(decodeURIComponent(reset[1]))
    if (path.startsWith("/admin/settings/history")) return json({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 })
    return json({}, 404)
  })
})

const renderPage = async () => {
  render(<SiteSettingsPage />)
  await screen.findByLabelText("VAT rate")
}

describe("load and group", () => {
  it("shows every group in the API's order with its heading and description", async () => {
    await renderPage()
    const headings = screen.getAllByRole("region").map((region) => within(region).getAllByText(/./)[0].textContent)
    expect(headings).toEqual(["Sales and VAT", "End of day", "Dashboard", "Public board", "Tills", "Sessions", "Offline"])
    expect(screen.getByText("The VAT rate charged on new sales and stock receipts.")).toBeInTheDocument()
    expect(within(row("vat.standard-rate")).getByText("Server description of vat.standard-rate.")).toBeInTheDocument()
  })

  it("shows values by type: VAT as a percentage, minutes, dates, on/off", async () => {
    await renderPage()
    expect(screen.getByLabelText("VAT rate")).toHaveValue("15.00")
    expect(screen.getByLabelText("End an idle session after")).toHaveValue("45")
    expect(screen.getByLabelText("First trading day")).toHaveValue("2026-10-12")
    expect(screen.getByRole("switch", { name: "Only registered tills may sell" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByLabelText("Trading hours: start")).toHaveValue("06:00")
  })

  it("shows the effects of a change next to the settings that need it", async () => {
    await renderPage()
    expect(within(row("vat.standard-rate")).getByText(/applies to new sales and new stock receipt lines only.*offline tills pick it up at their next refresh/i)).toBeInTheDocument()
    expect(within(row("pos.session.idle-expiry-minutes")).getByText(/lowering it can end sessions/i)).toBeInTheDocument()
  })
})

describe("default vs changed, and reset", () => {
  it("shows Default, or Changed with the default, and Reset only when changed", async () => {
    await renderPage()
    expect(status("vat.standard-rate")).toBe("Default")
    expect(within(row("vat.standard-rate")).queryByRole("button", { name: "Reset" })).not.toBeInTheDocument()
    expect(status("pos.session.idle-expiry-minutes")).toBe("Changed (default: 30 minutes)")
    expect(within(row("pos.session.idle-expiry-minutes")).getByText(/Last changed by Canteen Admin/)).toBeInTheDocument()
  })

  it("a value saved equal to the default still shows Changed, with the default as a percentage", async () => {
    current = settingsBody({ "vat.standard-rate": { value: 0.15, isDefault: false } })
    await renderPage()
    expect(status("vat.standard-rate")).toBe("Changed (default: 15.00 %)")
  })

  it("resets at once after a confirm, keeping the other unsaved edits", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.change(screen.getByLabelText("End an idle session after"), { target: { value: "50" } })
    resetAnswer = () => json(settingsBody())
    fireEvent.click(within(row("pos.session.idle-expiry-minutes")).getByRole("button", { name: "Reset" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Reset End an idle session after to the default \(30 minutes\)\?/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset to default" }))

    await waitFor(() => expect(status("pos.session.idle-expiry-minutes")).toBe("Default"))
    expect(calls("POST")[0][0]).toBe("/admin/settings/pos.session.idle-expiry-minutes/reset")
    expect(screen.getByLabelText("End an idle session after")).toHaveValue("30")
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("8")
    expect(screen.getByRole("button", { name: "Save (1)" })).toBeEnabled()
  })

  it("a reset refused by a cross-field rule shows under both fields; nothing changes", async () => {
    current = settingsBody({ "pos.session.idle-lock-minutes": { value: 40 }, "pos.session.idle-expiry-minutes": { value: 45 } })
    resetAnswer = () =>
      json(
        {
          "pos.session.idle-lock-minutes": "Must be at most the idle expiry time (30).",
          "pos.session.idle-expiry-minutes": "Must be at least the idle lock time (40).",
        },
        400,
      )
    await renderPage()
    fireEvent.click(within(row("pos.session.idle-expiry-minutes")).getByRole("button", { name: "Reset" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reset to default" }))

    expect(await within(row("pos.session.idle-lock-minutes")).findByText("Must be at most the idle expiry time (30).")).toBeInTheDocument()
    expect(within(row("pos.session.idle-expiry-minutes")).getByText("Must be at least the idle lock time (40).")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("End an idle session after wasn't reset; nothing was changed.")
    expect(status("pos.session.idle-expiry-minutes")).toBe("Changed (default: 30 minutes)")
  })

  it("a reset of a setting that no longer exists says so and reloads", async () => {
    resetAnswer = () => json({ error: "Unknown", code: "UNKNOWN_SETTING" }, 404)
    await renderPage()
    fireEvent.click(within(row("pos.session.idle-expiry-minutes")).getByRole("button", { name: "Reset" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reset to default" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("This setting no longer exists. The list has been reloaded.")
    await waitFor(() => expect(calls("GET").filter(([path]) => path === "/admin/settings")).toHaveLength(2))
  })
})

describe("save", () => {
  it("sends only the changed settings in one PUT, VAT as an exact fraction", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "15.5" } })
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "10" } })
    // Changed and changed back: not sent.
    fireEvent.change(screen.getByLabelText("Keep ready orders on the board for"), { target: { value: "3" } })
    fireEvent.change(screen.getByLabelText("Keep ready orders on the board for"), { target: { value: "10" } })
    fireEvent.click(screen.getByRole("switch", { name: "Only registered tills may sell" }))
    fireEvent.change(screen.getByLabelText("First trading day"), { target: { value: "" } })

    putAnswer = (body) => json(settingsBody(Object.fromEntries(Object.entries(body).map(([k, v]) => [k, { value: v as never }]))))
    fireEvent.click(screen.getByRole("button", { name: "Save (4)" }))

    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    expect(putBody()).toEqual({
      "vat.standard-rate": 0.155,
      "pos.session.idle-lock-minutes": 10,
      "pos.tills.require-registered": true,
      "reports.close-day.first-trading-day": null,
    })
    await waitFor(() => expect(status("vat.standard-rate")).toBe("Changed (default: 15.00 %)"))
    expect(screen.getByLabelText("VAT rate")).toHaveValue("15.50")
    expect(screen.getByText("No unsaved changes.")).toBeInTheDocument()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Settings saved" }))
  })

  it("holds Save back while a value is invalid, with the message under the field", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "15.555" } })
    expect(within(row("vat.standard-rate")).getByText("Enter a percentage between 0 and 99.99, with at most 2 decimals.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Trading hours: start"), { target: { value: "16:00" } })
    expect(within(row("dashboard.openingHours")).getByText("The start must be before the end.")).toBeInTheDocument()
  })

  it("400: all or nothing; each message under its field, cross-field on both, unknown keys at the top", async () => {
    putAnswer = () =>
      json(
        {
          "pos.session.idle-lock-minutes": "Must be at most the idle expiry time (30).",
          "pos.session.idle-expiry-minutes": "Must be at least the idle lock time (40).",
          "vat.standard-rate": "Must be between 0 and 0.9999 with at most 4 decimals.",
          "vat.standrad-rate": "Unknown setting.",
        },
        400,
      )
    await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "40" } })
    fireEvent.change(screen.getByLabelText("End an idle session after"), { target: { value: "30" } })
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "16" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (3)" }))

    expect(await within(row("pos.session.idle-lock-minutes")).findByText("Must be at most the idle expiry time (30).")).toBeInTheDocument()
    expect(within(row("pos.session.idle-expiry-minutes")).getByText("Must be at least the idle lock time (40).")).toBeInTheDocument()
    // The server's fraction-terms message is replaced by the screen's.
    expect(within(row("vat.standard-rate")).getByText("Enter a percentage between 0 and 99.99, with at most 2 decimals.")).toBeInTheDocument()
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Nothing was saved. Check the highlighted settings.")
    expect(alert).toHaveTextContent("vat.standrad-rate: Unknown setting.")
    // Nothing saved: the edits stay, the statuses don't change.
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("40")
    expect(status("pos.session.idle-lock-minutes")).toBe("Default")
    expect(toast).not.toHaveBeenCalled()

    // Editing a field clears its server message.
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "20" } })
    expect(within(row("pos.session.idle-lock-minutes")).queryByText("Must be at most the idle expiry time (30).")).not.toBeInTheDocument()
  })

  it("400 with a body message shows it at the top", async () => {
    putAnswer = () => json({ body: "Must be a JSON object of settings." }, 400)
    await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Must be a JSON object of settings.")
  })

  it("Discard changes puts every value back", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }))
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("5")
  })
})

describe("offline without the entitlement", () => {
  it("greys the offline settings with the reason; they can still be changed and saved", async () => {
    current = settingsBody({}, false)
    await renderPage()
    const offline = screen.getByRole("region", { name: /Offline/ })
    expect(within(offline).getByRole("note")).toHaveTextContent("Offline selling isn't switched on for this site. You can still change these; they apply when it is.")
    expect(row("pos.offline.max-offline-hours")).toHaveAttribute("data-inactive", "true")
    expect(row("vat.standard-rate")).not.toHaveAttribute("data-inactive")

    const input = screen.getByLabelText("Longest time a till may sell offline")
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }))
    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    expect(putBody()).toEqual({ "pos.offline.max-offline-hours": 8 })
  })
})

describe("tabs", () => {
  it("shows the change history, and unsaved edits survive switching tabs", async () => {
    window.history.replaceState(null, "", "/site-settings")
    await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("tab", { name: "Change history" }))
    expect(await screen.findByText("No settings have been changed yet.")).toBeInTheDocument()
    expect(window.location.search).toBe("?tab=history")
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }))
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("8")
    expect(window.location.search).toBe("")
  })
})

describe("unsaved changes", () => {
  const beforeUnload = () => {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  const appLink = () => {
    const link = document.createElement("a")
    link.href = "/dashboard"
    link.textContent = "Dashboard link"
    document.body.appendChild(link)
    return link
  }

  it("warns before leaving with unsaved edits, and not once they are saved", async () => {
    window.history.replaceState(null, "", "/site-settings")
    await renderPage()
    expect(beforeUnload()).toBe(false)

    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    expect(beforeUnload()).toBe(true)
    const link = appLink()
    fireEvent.click(link)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Leave without saving?")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay on this page" }))
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("8")

    fireEvent.click(link)
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Leave without saving" }))
    expect(push).toHaveBeenCalledWith("/dashboard")
    link.remove()
  })

  it("no warning once saved", async () => {
    putAnswer = () => json(settingsBody({ "pos.session.idle-lock-minutes": { value: 8 } }))
    await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }))
    await screen.findByText("No unsaved changes.")
    // The page hears "not dirty" from the form one render later, then removes the listener.
    await waitFor(() => expect(beforeUnload()).toBe(false))
  })

  it("no warning when leaving for the password re-sign-in (the edits are kept)", async () => {
    putAnswer = () => json({ error: "Sign in again", code: "REAUTH_REQUIRED", details: { keys: ["vat.standard-rate"] } }, 403)
    await renderPage()
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "16" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fsite-settings"))
    expect(beforeUnload()).toBe(false)
    expect(screen.queryByText("Leave without saving?")).not.toBeInTheDocument()
  })
})

describe("ADMIN only", () => {
  it.each(["CASHIER", "HEAD_CHEF", "STOCK_ADMIN"])("sends %s to their own page and loads nothing", (other) => {
    role = other
    const { container } = render(<SiteSettingsPage />)
    expect(container).toBeEmptyDOMElement()
    expect(replace).toHaveBeenCalled()
    expect(replace.mock.calls[0][0]).not.toBe("/site-settings")
    expect(authFetch).not.toHaveBeenCalled()
  })
})
