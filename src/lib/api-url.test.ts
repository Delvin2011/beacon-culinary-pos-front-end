// T1-0d: the one place an API address is made.
import { describe, expect, it } from "vitest"
import { API_PREFIX, apiUrl } from "@/lib/api-url"

describe("apiUrl", () => {
  it("puts /api in front of the backend path, on the page's own address", () => {
    expect(API_PREFIX).toBe("/api")
    expect(apiUrl("/auth/login")).toBe("/api/auth/login")
    expect(apiUrl("/pos/offline/sales")).toBe("/api/pos/offline/sales")
    expect(apiUrl("/kitchen/orders/stream")).toBe("/api/kitchen/orders/stream")
    expect(apiUrl("/users/login-tiles?screen=BAR")).toBe("/api/users/login-tiles?screen=BAR")
    expect(apiUrl("/")).toBe("/api/")
  })

  it("never makes an address on another host", () => {
    for (const bad of ["http://localhost:8080/auth/login", "https://api.example.com/x", "//evil.example/x"]) {
      expect(() => apiUrl(bad)).toThrow(/backend path starting with "\/"/)
    }
  })

  it("refuses a path without the leading slash", () => {
    expect(() => apiUrl("auth/login")).toThrow(/starting with "\/"/)
    expect(() => apiUrl("")).toThrow(/starting with "\/"/)
  })

  it("refuses a path that already has the prefix, so it is never doubled", () => {
    for (const bad of ["/api", "/api/auth/login", "/api?x=1"]) {
      expect(() => apiUrl(bad)).toThrow(/already starts with \/api/)
    }
    // A backend path that merely begins with the letters is fine.
    expect(apiUrl("/apikeys")).toBe("/api/apikeys")
  })
})
