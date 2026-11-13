import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { saveRegisterDraft, takeRegisterDraft } from "@/lib/register-draft"

const KEY = "devices.register.draft"

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("register draft", () => {
  it("restores the three fields once, then deletes them", () => {
    saveRegisterDraft({ name: "Till 1", serialNumber: "pf3x 9k2b", assetTag: "BC-0042" })
    expect(takeRegisterDraft()).toEqual({ name: "Till 1", serialNumber: "pf3x 9k2b", assetTag: "BC-0042" })
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(takeRegisterDraft()).toBeNull()
  })

  it("never stores anything but the three fields", () => {
    saveRegisterDraft({ name: "Till 1", serialNumber: "S1", assetTag: "", password: "secret1" } as never)
    expect(JSON.parse(String(sessionStorage.getItem(KEY)))).toEqual({ name: "Till 1", serialNumber: "S1", assetTag: "" })
  })

  it("ignores bad stored data", () => {
    sessionStorage.setItem(KEY, "{not json")
    expect(takeRegisterDraft()).toBeNull()
    sessionStorage.setItem(KEY, JSON.stringify({ name: 5, password: "x" }))
    expect(takeRegisterDraft()).toEqual({ name: "", serialNumber: "", assetTag: "" })
  })

  it("doesn't throw when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => saveRegisterDraft({ name: "a", serialNumber: "b", assetTag: "c" })).not.toThrow()
    expect(takeRegisterDraft()).toBeNull()
  })
})
