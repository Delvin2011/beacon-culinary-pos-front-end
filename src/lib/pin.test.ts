import { describe, expect, it } from "vitest"
import { PIN_PATTERN, isPinFormatError } from "@/lib/pin"

describe("PIN_PATTERN", () => {
  it("accepts exactly 6 digits", () => {
    expect(PIN_PATTERN.test("123456")).toBe(true)
    expect(PIN_PATTERN.test("000000")).toBe(true)
  })

  it.each(["", "12345", "1234567", "12345a", "12 456", " 123456", "123456 ", "１２３４５６"])("refuses %j", (pin) => {
    expect(PIN_PATTERN.test(pin)).toBe(false)
  })
})

describe("isPinFormatError", () => {
  it("recognises the backend's 400 body", () => {
    expect(isPinFormatError({ pin: "PIN must be 6 digits" })).toBe(true)
  })

  it.each([null, undefined, "pin", {}, { error: "Invalid PIN." }, { pin: 6 }])("ignores %j", (body) => {
    expect(isPinFormatError(body)).toBe(false)
  })
})
