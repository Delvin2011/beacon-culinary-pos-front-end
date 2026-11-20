import { describe, expect, it } from "vitest"
import { reauthLoginPath, safeReturnTo } from "@/lib/return-to"

describe("safeReturnTo", () => {
  it.each(["/devices", "/devices/register", "/pos-activity", "/site-settings"])("accepts %s", (path) => {
    expect(safeReturnTo(path)).toBe(path)
  })

  it.each([
    ["missing", null],
    ["undefined", undefined],
    ["empty", ""],
    ["protocol-relative", "//evil.com"],
    ["protocol-relative to an allowed path", "//evil.com/devices"],
    ["backslash", "/\\evil.com"],
    ["full URL", "https://evil.com/devices"],
    ["javascript:", "javascript:alert(1)"],
    ["no leading slash", "devices"],
    ["unknown route", "/dashboard"],
    ["sub-path", "/devices/register/extra"],
    ["query string", "/devices?x=1"],
    ["fragment", "/devices#top"],
    ["trailing slash", "/devices/"],
    ["encoded slashes", "%2F%2Fevil.com"],
    ["encoded path", "/devices%2Fregister"],
    ["newline", "/devices\n"],
    ["tab", "/devi\tces"],
    ["leading space", " /devices"],
    ["sub-path of site settings", "/site-settings/history"],
    ["site settings with a query", "/site-settings?tab=history"],
  ])("rejects %s", (_name, value) => {
    expect(safeReturnTo(value)).toBeNull()
  })
})

describe("reauthLoginPath", () => {
  it("builds the re-sign-in link", () => {
    expect(reauthLoginPath("/devices/register")).toBe("/login?reauth=1&returnTo=%2Fdevices%2Fregister")
  })
})
