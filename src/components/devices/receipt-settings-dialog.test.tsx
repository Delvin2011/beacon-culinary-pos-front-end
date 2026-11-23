// O2b: the admin Receipt settings dialog, opened from Registered tills (contract 2.3, 2.4).
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { ReceiptSettingsDialog } from "@/components/devices/receipt-settings-dialog"

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

let getAnswer: () => Response
let putAnswer: (body: Record<string, unknown>) => Response
const puts = () =>
  fetchMock.mock.calls
    .filter(([input, init]) => String(input).endsWith("/admin/receipt-settings") && init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "boss@x.co", name: "Boss", role: "ADMIN" } }))
  getAnswer = () => json(200, stored)
  putAnswer = (body) => json(200, { ...body, updatedAt: "2026-11-18T09:00:00Z", updatedBy: "Boss" })
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace(/^(?:https?:\/\/[^/]+)?\/api(?=\/)/, "")
    if (path === "/admin/receipt-settings" && init?.method === "PUT") return putAnswer(JSON.parse(String(init.body)))
    if (path === "/admin/receipt-settings") return getAnswer()
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

async function renderDialog(onClose = vi.fn()) {
  render(
    <AuthProvider>
      <ReceiptSettingsDialog open onClose={onClose} />
    </AuthProvider>,
  )
  await screen.findByDisplayValue("Canteen at Riverside Park")
  return onClose
}

const saveButton = () => screen.getByRole("button", { name: "Save" })
const cancelButton = () => screen.getByRole("button", { name: "Cancel" })

async function save() {
  await act(async () => {
    fireEvent.click(saveButton())
  })
}

describe("Receipt settings dialog", () => {
  it("loads every field and shows when and by whom they were last saved, in local time", async () => {
    await renderDialog()
    expect(screen.getByLabelText("Receipt title (e.g. Tax Invoice)")).toHaveValue("Tax Invoice")
    expect(screen.getByLabelText("Address line 3")).toHaveValue("Cape Town 8001")
    expect(screen.getByLabelText("Address line 4")).toHaveValue("")
    expect(screen.getByLabelText("Footer text")).toHaveValue("Thank you!\nKeep this slip for refunds.")
    expect(screen.getByRole("checkbox", { name: "Show the VAT line on receipts" })).toBeChecked()
    // 07:30 UTC is 09:30 in Johannesburg.
    expect(screen.getByText(/Last saved by Canteen Admin at .*09:30/)).toBeInTheDocument()
  })

  it("hides the last-saved line before the first save", async () => {
    getAnswer = () => json(200, { ...stored, updatedAt: null, updatedBy: null })
    await renderDialog()
    expect(screen.queryByText(/Last saved/)).not.toBeInTheDocument()
  })

  it("enables Save only when something changed; Cancel is always enabled", async () => {
    await renderDialog()
    expect(saveButton()).toBeDisabled()
    expect(cancelButton()).toBeEnabled()

    const phone = screen.getByLabelText("Phone")
    fireEvent.change(phone, { target: { value: "021 555 0199" } })
    expect(saveButton()).toBeEnabled()

    // Back to what was loaded, or only spaces added: nothing to save.
    fireEvent.change(phone, { target: { value: "021 555 0100" } })
    expect(saveButton()).toBeDisabled()
    fireEvent.change(phone, { target: { value: "021 555 0100  " } })
    expect(saveButton()).toBeDisabled()

    fireEvent.click(screen.getByRole("checkbox", { name: "Show the VAT line on receipts" }))
    expect(saveButton()).toBeEnabled()
    fireEvent.click(screen.getByRole("checkbox", { name: "Show the VAT line on receipts" }))
    expect(saveButton()).toBeDisabled()
  })

  it("Cancel closes without saving", async () => {
    const onClose = await renderDialog()
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "021 555 0199" } })
    fireEvent.click(cancelButton())
    expect(onClose).toHaveBeenCalled()
    expect(puts()).toHaveLength(0)
  })

  it("saves every field, sending back unedited ones as loaded (receiptTitle kept), and closes", async () => {
    const onClose = await renderDialog()
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
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it("sends a cleared field as null", async () => {
    await renderDialog()
    fireEvent.change(screen.getByLabelText("Receipt title (e.g. Tax Invoice)"), { target: { value: "   " } })
    await save()
    expect(puts()[0].receiptTitle).toBeNull()
    expect(puts()[0].showVatLine).toBe(true)
  })

  it("shows each 400 message under its field, several at once, and stays open", async () => {
    putAnswer = () =>
      json(400, {
        addressLines: "At most 4 address lines.",
        vatNumber: "VAT number must be 20 characters or fewer.",
        receiptTitle: "Receipt title must be 50 characters or fewer.",
      })
    const onClose = await renderDialog()
    fireEvent.change(screen.getByLabelText("VAT number"), { target: { value: "41234567890" } })
    await save()

    expect(await screen.findByText("VAT number must be 20 characters or fewer.")).toHaveAttribute("id", "vatNumber-error")
    expect(screen.getByText("At most 4 address lines.")).toHaveAttribute("id", "addressLines-error")
    expect(screen.getByText("Receipt title must be 50 characters or fewer.")).toHaveAttribute("id", "receiptTitle-error")
    expect(screen.getByLabelText("VAT number")).toHaveAttribute("aria-invalid", "true")
    expect(onClose).not.toHaveBeenCalled()
  })
})
