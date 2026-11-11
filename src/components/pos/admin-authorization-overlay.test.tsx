import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AdminAuthorizationOverlay } from "@/components/pos/admin-authorization-overlay"

function renderOverlay(pin: string) {
  render(
    <AdminAuthorizationOverlay
      isOpen
      title="Manager PIN Required"
      description="Enter admin PIN."
      pin={pin}
      onPinChange={() => {}}
      onSubmit={() => {}}
      onBack={() => {}}
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
})
