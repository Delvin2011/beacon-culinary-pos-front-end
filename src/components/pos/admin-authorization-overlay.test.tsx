import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AdminAuthorizationOverlay } from "@/components/pos/admin-authorization-overlay"

function renderOverlay(pin: string, blocked = false) {
  render(
    <AdminAuthorizationOverlay
      isOpen
      title="Manager PIN Required"
      description="Enter admin PIN."
      pin={pin}
      onPinChange={() => {}}
      onSubmit={() => {}}
      onBack={() => {}}
      blocked={blocked}
    />,
  )
  return screen.getByRole("button", { name: "Authorize" })
}

describe("AdminAuthorizationOverlay", () => {
  it.each(["", "1234", "12345"])("disables submit for %j", (pin) => {
    expect(renderOverlay(pin)).toBeDisabled()
  })

  it("enables submit at exactly 6 digits", () => {
    expect(renderOverlay("123456")).toBeEnabled()
  })

  it("disables the keypad and submit while blocked, leaving Back usable", () => {
    expect(renderOverlay("123456", true)).toBeDisabled()
    expect(screen.getByRole("button", { name: "1" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled()
  })
})
