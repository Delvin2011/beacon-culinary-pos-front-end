// O2b: the admin Receipt settings screen (contract 2.3, 2.4).
import type { ReactNode } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import ReceiptSettingsPage from "@/app/receipt-settings/page"

const push = vi.fn()
const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }))
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }))
vi.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarInset: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => null,
}))

const fetchMock = vi.fn<typeof fetch>()
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const stored = {
  receiptTitle: "Tax Invoice",
  businessName: "Canteen at Riverside Park",
  addressLines: ["12 Main Road", "Riverside", "Cape Town 8001"],
  phone: "021 555 0100",
  vatNumber: "4123456789",
  footerText: "Thank you!\nKeep this slip for refunds.",
  showVatLine: true,
  updatedAt: "2026-11-18T07:30:00Z",
  updatedBy: "Canteen Admin",
}

let putAnswer: (body: Record<string, unknown>) => Response
const puts = () =>
  fetchMock.mock.calls
    .filter(([input, init]) => String(input).endsWith("/admin/receipt-settings") && init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

function signIn(role: string) {
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", name: "Boss", role } }))
}

beforeEach(() => {
  localStorage.clear()
  signIn("ADMIN")
  push.mockReset()
  replace.mockReset()
  putAnswer = (body) => json(200, { ...body, updatedAt: "2026-11-18T09:00:00Z", updatedBy: "Boss" })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "")
    if (path === "/admin/receipt-settings" && init?.method === "PUT") return putAnswer(JSON.parse(String(init.body)))
    if (path === "/admin/receipt-settings") return json(200, stored)
    return json(404, {})
  })
  vi.stubGlobal("fetch", fetchMock)
  // Radix's Checkbox measures itself inside a <form>; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderPage() {
  render(
    <AuthProvider>
      <ReceiptSettingsPage />
    </AuthProvider>,
  )
  await screen.findByDisplayValue("Canteen at Riverside Park")
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
  })
}

describe("Receipt settings", () => {
  it("loads every field and shows when and by whom they were last saved, in local time", async () => {
    await renderPage()
    expect(screen.getByLabelText("Receipt title (e.g. Tax Invoice)")).toHaveValue("Tax Invoice")
    expect(screen.getByLabelText("Address line 3")).toHaveValue("Cape Town 8001")
    expect(screen.getByLabelText("Address line 4")).toHaveValue("")
    expect(screen.getByLabelText("Footer text")).toHaveValue("Thank you!\nKeep this slip for refunds.")
    expect(screen.getByRole("checkbox", { name: "Show the VAT line on receipts" })).toBeChecked()
    // 07:30 UTC is 09:30 in Johannesburg.
    expect(screen.getByText(/Last saved by Canteen Admin at .*09:30/)).toBeInTheDocument()
  })

  it("hides the last-saved line before the first save", async () => {
    fetchMock.mockImplementation(async () => json(200, { ...stored, updatedAt: null, updatedBy: null }))
    await renderPage()
    expect(screen.queryByText(/Last saved/)).not.toBeInTheDocument()
  })

  it("saves every field, sending back unedited ones as loaded (receiptTitle kept)", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 555 0199" } })
    fireEvent.change(screen.getByLabelText("Address line 2"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("checkbox", { name: "Show the VAT line on receipts" }))
    await save()

    expect(puts()).toEqual([
      {
        receiptTitle: "Tax Invoice",
        businessName: "Canteen at Riverside Park",
        addressLines: ["12 Main Road", "Cape Town 8001"],
        phone: "021 555 0199",
        vatNumber: "4123456789",
        footerText: "Thank you!\nKeep this slip for refunds.",
        showVatLine: false,
      },
    ])
    await waitFor(() => expect(screen.getByText(/Last saved by Boss/)).toBeInTheDocument())
  })

  it("sends a cleared field as null", async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText("Receipt title (e.g. Tax Invoice)"), { target: { value: "   " } })
    await save()
    expect(puts()[0].receiptTitle).toBeNull()
    expect(puts()[0].showVatLine).toBe(true)
  })

  it("shows each 400 message under its field, several at once", async () => {
    putAnswer = () =>
      json(400, {
        addressLines: "At most 4 address lines.",
        vatNumber: "VAT number must be 20 characters or fewer.",
        receiptTitle: "Receipt title must be 50 characters or fewer.",
      })
    await renderPage()
    fireEvent.change(screen.getByLabelText("VAT number"), { target: { value: "41234567890" } })
    await save()

    expect(await screen.findByText("VAT number must be 20 characters or fewer.")).toHaveAttribute("id", "vatNumber-error")
    expect(screen.getByText("At most 4 address lines.")).toHaveAttribute("id", "addressLines-error")
    expect(screen.getByText("Receipt title must be 50 characters or fewer.")).toHaveAttribute("id", "receiptTitle-error")
    expect(screen.getByLabelText("VAT number")).toHaveAttribute("aria-invalid", "true")
  })

  it("is hidden for anyone but an ADMIN", async () => {
    localStorage.clear()
    signIn("CASHIER")
    render(
      <AuthProvider>
        <ReceiptSettingsPage />
      </AuthProvider>,
    )
    await waitFor(() => expect(replace).toHaveBeenCalled())
    expect(screen.queryByText("Receipt settings")).not.toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/admin/receipt-settings"))).toBe(false)
  })
})
