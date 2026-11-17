// O2b: the per-till auto-print switches, changed on the till itself and stored in its browser.
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, expect, it } from "vitest"
import { PrintSettingsCard } from "@/components/devices/print-settings-card"
import { PRINT_SETTINGS_KEY, loadPrintSettings, resetPrintSettingsSnapshot } from "@/lib/print-settings"

beforeEach(() => {
  localStorage.clear()
  resetPrintSettingsSnapshot()
})

it("shows both switches on by default and stores each change in this browser", () => {
  render(<PrintSettingsCard />)
  const receipt = screen.getByRole("checkbox", { name: "Print receipt automatically" })
  const ticket = screen.getByRole("checkbox", { name: "Print kitchen ticket automatically" })
  expect(receipt).toBeChecked()
  expect(ticket).toBeChecked()

  fireEvent.click(receipt)
  expect(receipt).not.toBeChecked()
  expect(loadPrintSettings()).toEqual({ autoPrintReceipt: false, autoPrintKitchenTicket: true })

  fireEvent.click(ticket)
  expect(ticket).not.toBeChecked()
  expect(JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY)!)).toEqual({ autoPrintReceipt: false, autoPrintKitchenTicket: false })
})
