// O2b: the receipt settings (cached per sign-in) and the per-till auto-print switches.
import { act, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/contexts/auth-context"
import { useAuth } from "@/hooks/use-auth"
import { resetReceiptSettingsCache, useReceiptSettings } from "@/hooks/use-receipt-settings"
import { fetchReceiptSettings, parseReceiptSettings } from "@/lib/receipt-settings"
import {
  DEFAULT_PRINT_SETTINGS,
  PRINT_SETTINGS_KEY,
  loadPrintSettings,
  resetPrintSettingsSnapshot,
  savePrintSettings,
  usePrintSettings,
} from "@/lib/print-settings"

const fetchMock = vi.fn<typeof fetch>()

const filled = {
  receiptTitle: "Tax Invoice",
  businessName: "Canteen at Riverside Park",
  addressLines: ["12 Main Road", "", "Riverside"],
  phone: "021 555 0100",
  vatNumber: "4123456789",
  footerText: "Thank you!\nKeep this slip for refunds.",
  showVatLine: true,
}

beforeEach(() => {
  localStorage.clear()
  resetReceiptSettingsCache()
  resetPrintSettingsSnapshot()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseReceiptSettings", () => {
  it("keeps the fields, drops blank address lines and treats blanks as none", () => {
    expect(parseReceiptSettings({ ...filled, phone: "  " })).toEqual({ ...filled, addressLines: ["12 Main Road", "Riverside"], phone: null })
  })

  it("reads the contract's empty defaults", () => {
    expect(
      parseReceiptSettings({ receiptTitle: null, businessName: null, addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: false }),
    ).toEqual({ receiptTitle: null, businessName: null, addressLines: [], phone: null, vatNumber: null, footerText: null, showVatLine: false })
  })

  it("gives null for a body that isn't an object", () => {
    expect(parseReceiptSettings(null)).toBeNull()
    expect(parseReceiptSettings([])).toBeNull()
  })
})

describe("fetchReceiptSettings", () => {
  it("gives null on a 403, a network failure or a bad body, and never throws", async () => {
    const authFetch = vi.fn<(path: string) => Promise<Response>>()
    authFetch.mockResolvedValueOnce(new Response("{}", { status: 403 }))
    expect(await fetchReceiptSettings(authFetch)).toBeNull()
    authFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    expect(await fetchReceiptSettings(authFetch)).toBeNull()
    authFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }))
    expect(await fetchReceiptSettings(authFetch)).toBeNull()
    expect(authFetch).toHaveBeenCalledWith("/pos/receipt-settings")
  })
})

function SettingsProbe() {
  const settings = useReceiptSettings()
  const { logout } = useAuth()
  return (
    <div>
      <p>{settings ? settings.businessName : "no settings"}</p>
      <button onClick={() => void logout()}>Sign out</button>
    </div>
  )
}

describe("useReceiptSettings", () => {
  it("fetches once per sign-in, shared by every screen, and drops the cache on sign-out", async () => {
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "t@x.co", role: "CASHIER" } }))
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith("/pos/receipt-settings")) return new Response(JSON.stringify(filled), { status: 200 })
      return new Response("{}", { status: 200 })
    })

    render(
      <AuthProvider>
        <SettingsProbe />
        <SettingsProbe />
      </AuthProvider>,
    )

    await waitFor(() => expect(screen.getAllByText("Canteen at Riverside Park")).toHaveLength(2))
    const settingsCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/pos/receipt-settings")).length
    expect(settingsCalls()).toBe(1)

    await act(async () => {
      screen.getAllByText("Sign out")[0].click()
    })
    await waitFor(() => expect(screen.getAllByText("no settings")).toHaveLength(2))
  })
})

function SwitchesProbe() {
  const settings = usePrintSettings()
  return (
    <p>
      receipt {String(settings.autoPrintReceipt)} · ticket {String(settings.autoPrintKitchenTicket)}
    </p>
  )
}

describe("print settings", () => {
  it("default to both on, also when storage holds rubbish", () => {
    expect(loadPrintSettings()).toEqual(DEFAULT_PRINT_SETTINGS)
    localStorage.setItem(PRINT_SETTINGS_KEY, "{not json")
    expect(loadPrintSettings()).toEqual(DEFAULT_PRINT_SETTINGS)
  })

  it("switch each automatic print off separately, stored on this till", () => {
    render(<SwitchesProbe />)
    expect(screen.getByText("receipt true · ticket true")).toBeInTheDocument()

    act(() => savePrintSettings({ autoPrintReceipt: false, autoPrintKitchenTicket: true }))
    expect(screen.getByText("receipt false · ticket true")).toBeInTheDocument()
    act(() => savePrintSettings({ autoPrintReceipt: true, autoPrintKitchenTicket: false }))
    expect(screen.getByText("receipt true · ticket false")).toBeInTheDocument()

    resetPrintSettingsSnapshot()
    expect(loadPrintSettings()).toEqual({ autoPrintReceipt: true, autoPrintKitchenTicket: false })
  })
})
