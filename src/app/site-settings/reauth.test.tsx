// T0-4b: sensitive settings and REAUTH_REQUIRED. The edits (and a reset asked for) are kept through the password
// re-sign-in, with no password or token; back on the page they are put back, the sensitive ones are highlighted, and
// a setting someone else saved meanwhile is pointed out before saving over it.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SiteSettingsPage from "@/app/site-settings/page"
import { settingsBody } from "@/lib/site-settings.test-fixtures"
import type { SiteSettings } from "@/lib/site-settings"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/site-settings" }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }))

const authFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { name: "Ayanda", role: "ADMIN" }, authFetch }),
}))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const reauth = (keys: string[]) => json({ error: "Sign in again with your password.", code: "REAUTH_REQUIRED", details: { keys } }, 403)

let current: SiteSettings
let putAnswer: () => Response
let resetAnswer: () => Response
const calls = (method: string) => authFetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method)
const row = (key: string) => screen.getByTestId(`setting-${key}`)

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  sessionStorage.clear()
  current = settingsBody({ "pos.offline.account-cap": { value: 200 } })
  putAnswer = () => reauth(["vat.standard-rate"])
  resetAnswer = () => reauth(["pos.offline.account-cap"])
  authFetch.mockReset()
  authFetch.mockImplementation(async (path, init) => {
    if (path === "/admin/settings" && !init?.method) return json(current)
    if (path === "/admin/settings" && init?.method === "PUT") return putAnswer()
    if (path.endsWith("/reset") && init?.method === "POST") return resetAnswer()
    return json({}, 404)
  })
})

const renderPage = async () => {
  const view = render(<SiteSettingsPage />)
  await screen.findByLabelText("VAT rate")
  return view
}

const storedDraft = () => Object.entries(sessionStorage).map(([k, v]) => `${k}=${v}`).join("\n")

describe("REAUTH_REQUIRED on Save", () => {
  it("keeps the edits (no password or token), signs in again, and comes back with them", async () => {
    const first = await renderPage()
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "15.5" } })
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (2)" }))

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fsite-settings"))
    expect(storedDraft()).toContain("15.5")
    expect(storedDraft().toLowerCase()).not.toMatch(/password|token|bearer|secret/)
    first.unmount()

    // Back from the sign-in.
    authFetch.mockClear()
    await renderPage()
    expect(await screen.findByText(/You're signed in again\. Your unsaved changes are back/)).toBeInTheDocument()
    expect(screen.getByLabelText("VAT rate")).toHaveValue("15.5")
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("8")
    expect(row("vat.standard-rate")).toHaveAttribute("data-needs-sign-in", "true")
    expect(row("pos.session.idle-lock-minutes")).not.toHaveAttribute("data-needs-sign-in")
    expect(sessionStorage.getItem("pos.siteSettingsDraft")).toBeNull()
    // Nothing is sent until the admin saves again.
    expect(calls("PUT")).toHaveLength(0)

    putAnswer = () => json(settingsBody({ "vat.standard-rate": { value: 0.155 }, "pos.session.idle-lock-minutes": { value: 8 } }))
    fireEvent.click(screen.getByRole("button", { name: "Save (2)" }))
    await waitFor(() => expect(calls("PUT")).toHaveLength(1))
    expect(JSON.parse(String(calls("PUT")[0][1]?.body))).toEqual({ "vat.standard-rate": 0.155, "pos.session.idle-lock-minutes": 8 })
    expect(screen.queryByText(/You're signed in again/)).not.toBeInTheDocument()
  })

  it("points out a setting someone else saved meanwhile, and asks once before replacing it", async () => {
    const first = await renderPage()
    fireEvent.change(screen.getByLabelText("VAT rate"), { target: { value: "15.5" } })
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    first.unmount()

    current = settingsBody({
      "pos.offline.account-cap": { value: 200 },
      "vat.standard-rate": { value: 0.16, lastChange: { byName: "Other Admin", at: "2026-11-20T09:00:00Z", action: "SET" } },
    })
    await renderPage()
    expect(await screen.findByTestId("stale-notice")).toHaveTextContent("Someone else changed VAT rate since you started (now 16.00 %). Saving will replace it.")

    putAnswer = () => json(settingsBody({ "vat.standard-rate": { value: 0.155 } }))
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Someone else changed VAT rate since you started/)).toBeInTheDocument()
    expect(calls("PUT")).toHaveLength(1) // only the first, refused one
    fireEvent.click(within(dialog).getByRole("button", { name: "Save anyway" }))
    await waitFor(() => expect(calls("PUT")).toHaveLength(2))
  })

  it("drops a kept edit to a setting that no longer exists, and says so", async () => {
    sessionStorage.setItem(
      "pos.siteSettingsDraft",
      JSON.stringify({ edits: { "old.removed": "3", "pos.session.idle-lock-minutes": "8" }, pendingReset: null, baseline: {}, reauthKeys: [] }),
    )
    await renderPage()
    expect(await screen.findByText("old.removed is no longer a site setting, so its change was dropped.")).toBeInTheDocument()
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("8")
  })
})

describe("REAUTH_REQUIRED on Reset", () => {
  it("keeps the other edits and the reset asked for, and asks to confirm the reset again on return", async () => {
    const first = await renderPage()
    fireEvent.change(screen.getByLabelText("Lock an idle till after"), { target: { value: "8" } })
    fireEvent.click(within(row("pos.offline.account-cap")).getByRole("button", { name: "Reset" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reset to default" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login?reauth=1&returnTo=%2Fsite-settings"))
    first.unmount()

    authFetch.mockClear()
    resetAnswer = () => json(settingsBody())
    await renderPage()
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/You're signed in again\. Confirm the reset you asked for\./)).toBeInTheDocument()
    expect(within(dialog).getByText(/Reset Offline account limit to the default/)).toBeInTheDocument()
    expect(calls("POST")).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset to default" }))

    await waitFor(() => expect(calls("POST")).toHaveLength(1))
    expect(calls("POST")[0][0]).toBe("/admin/settings/pos.offline.account-cap/reset")
    await waitFor(() => expect(within(row("pos.offline.account-cap")).getByTestId("setting-status")).toHaveTextContent("Default"))
    expect(screen.getByLabelText("Lock an idle till after")).toHaveValue("8")
  })
})
