// T0-4 site settings: value text <-> API values (VAT as a percentage, exact), limits, grouping, edits, the
// re-sign-in draft and the API calls with their errors by code.
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SiteSettingsError,
  buildBaseline,
  checkEdits,
  clearSiteSettingsDraft,
  fetchSettingsHistory,
  fetchSiteSettings,
  fieldMessage,
  formatSettingValue,
  groupSettings,
  historyPath,
  loadSiteSettingsDraft,
  parseInputText,
  pruneEdits,
  resetSettingPath,
  resetSiteSetting,
  saveSiteSettings,
  saveSiteSettingsDraft,
  shiftDecimal,
  staleKeys,
  toInputText,
} from "@/lib/site-settings"
import { settingOf, settingsBody } from "@/lib/site-settings.test-fixtures"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
const body = settingsBody()
const vat = settingOf(body, "vat.standard-rate")
const cap = settingOf(body, "pos.offline.account-cap")
const watch = settingOf(body, "dashboard.voidRefund.watchPercent")
const idleLock = settingOf(body, "pos.session.idle-lock-minutes")
const firstDay = settingOf(body, "reports.close-day.first-trading-day")
const hours = settingOf(body, "dashboard.openingHours")
const afterTime = settingOf(body, "dashboard.slowMeal.afterTime")
const requireRegistered = settingOf(body, "pos.tills.require-registered")

afterEach(() => {
  sessionStorage.clear()
})

describe("shiftDecimal", () => {
  it.each([
    ["0.15", 2, "15"],
    ["0.155", 2, "15.5"],
    ["0.9999", 2, "99.99"],
    ["0", 2, "0"],
    ["15", -2, "0.15"],
    ["15.5", -2, "0.155"],
    ["99.99", -2, "0.9999"],
    ["0.01", -2, "0.0001"],
    ["100", -2, "1"],
  ])("%s shifted %i is %s", (text, places, expected) => {
    expect(shiftDecimal(text, places)).toBe(expected)
  })
})

describe("VAT as a percentage", () => {
  it("shows the fraction as a percentage with 2 decimals", () => {
    expect(toInputText(vat, 0.15)).toBe("15.00")
    expect(toInputText(vat, 0.155)).toBe("15.50")
    expect(toInputText(vat, 0.1575)).toBe("15.75")
    expect(formatSettingValue(vat, 0.15)).toBe("15.00 %")
  })

  it.each([
    ["15", 0.15],
    ["15.00", 0.15],
    ["15.5", 0.155],
    ["15,5", 0.155],
    ["15.75", 0.1575],
    ["0", 0],
    ["99.99", 0.9999],
    ["14.01", 0.1401],
  ])("%s %% is sent as %f exactly", (text, value) => {
    expect(parseInputText(vat, text)).toEqual({ ok: true, value })
  })

  it.each(["15.555", "100", "-1", "abc", "1e2", ""])("refuses %s on the device, in percentage terms", (text) => {
    const result = parseInputText(vat, text)
    expect(result.ok).toBe(false)
    if (!result.ok && text !== "") expect(result.error).toBe("Enter a percentage between 0 and 99.99, with at most 2 decimals.")
  })

  it("replaces the server's fraction-terms 400 message with the screen's", () => {
    expect(fieldMessage("vat.standard-rate", "Must be between 0 and 0.9999 with at most 4 decimals.")).toBe(
      "Enter a percentage between 0 and 99.99, with at most 2 decimals.",
    )
    expect(fieldMessage("pos.session.idle-lock-minutes", "Must be at most the idle expiry time (30).")).toBe("Must be at most the idle expiry time (30).")
  })
})

describe("other types", () => {
  it("decimals: rand and percent, scale and limits", () => {
    expect(toInputText(cap, 150)).toBe("150.00")
    expect(parseInputText(cap, "200.5")).toEqual({ ok: true, value: 200.5 })
    expect(parseInputText(cap, "200.555")).toEqual({ ok: false, error: "Enter an amount between 0 and 99999999.99, with at most 2 decimals." })
    expect(parseInputText(watch, "100.01").ok).toBe(false)
    expect(formatSettingValue(watch, 3)).toBe("3.00 %")
  })

  it("integers: whole numbers within the limits", () => {
    expect(parseInputText(idleLock, "10")).toEqual({ ok: true, value: 10 })
    expect(parseInputText(idleLock, "0")).toEqual({ ok: false, error: "Enter a whole number between 1 and 1440." })
    expect(parseInputText(idleLock, "1.5").ok).toBe(false)
    expect(formatSettingValue(idleLock, 1)).toBe("1 minute")
    expect(formatSettingValue(idleLock, 5)).toBe("5 minutes")
  })

  it("booleans", () => {
    expect(parseInputText(requireRegistered, "true")).toEqual({ ok: true, value: true })
    expect(toInputText(requireRegistered, false)).toBe("false")
    expect(formatSettingValue(requireRegistered, true)).toBe("On")
  })

  it("dates: a calendar date; empty is null for the nullable first trading day", () => {
    expect(parseInputText(firstDay, "2026-10-12")).toEqual({ ok: true, value: "2026-10-12" })
    expect(parseInputText(firstDay, "")).toEqual({ ok: true, value: null })
    expect(parseInputText(firstDay, "2026-02-30").ok).toBe(false)
    expect(formatSettingValue(firstDay, "2026-10-12")).toBe("12 Oct 2026")
    expect(formatSettingValue(firstDay, null)).toBe("Empty")
  })

  it("times and time ranges", () => {
    expect(parseInputText(afterTime, "12:30")).toEqual({ ok: true, value: "12:30" })
    expect(parseInputText(afterTime, "24:00").ok).toBe(false)
    expect(parseInputText(hours, "06:00-15:00")).toEqual({ ok: true, value: "06:00-15:00" })
    expect(parseInputText(hours, "15:00-06:00")).toEqual({ ok: false, error: "The start must be before the end." })
    expect(parseInputText(hours, "06:00-")).toEqual({ ok: false, error: "Enter a start and an end time." })
    expect(formatSettingValue(hours, "06:00-15:00")).toBe("06:00–15:00")
  })
})

describe("groupSettings", () => {
  it("groups in the contract's order, unknown groups last", () => {
    const settings = [settingOf(body, "pos.session.idle-lock-minutes"), { ...vat, key: "x.new", group: "NEW_GROUP" }, vat]
    expect(groupSettings(settings).map((g) => g.group)).toEqual(["VAT", "SESSIONS", "NEW_GROUP"])
    expect(groupSettings(body.settings).map((g) => g.group)).toEqual(["VAT", "END_OF_DAY", "DASHBOARD", "BOARD", "TILLS", "SESSIONS", "OFFLINE"])
  })
})

describe("edits", () => {
  it("sends only values that differ; invalid text is held back", () => {
    const check = checkEdits(body.settings, {
      "vat.standard-rate": "15.00",
      "pos.session.idle-lock-minutes": "10",
      "pos.offline.account-cap": "abc",
      "reports.close-day.first-trading-day": "",
    })
    expect(check.changes).toEqual({ "pos.session.idle-lock-minutes": 10, "reports.close-day.first-trading-day": null })
    expect(Object.keys(check.invalid)).toEqual(["pos.offline.account-cap"])
  })

  it("prunes edits that now match the server", () => {
    const saved = settingsBody({ "pos.session.idle-lock-minutes": { value: 10 } })
    expect(pruneEdits(saved.settings, { "pos.session.idle-lock-minutes": "10", "board.done-display-minutes": "3", gone: "1" })).toEqual({
      "board.done-display-minutes": "3",
    })
  })
})

describe("the re-sign-in draft", () => {
  it("round-trips, and holds no password or token", () => {
    const draft = {
      edits: { "vat.standard-rate": "15.5" },
      pendingReset: "pos.offline.account-cap",
      baseline: buildBaseline(body.settings, ["vat.standard-rate", "pos.offline.account-cap"]),
      reauthKeys: ["vat.standard-rate"],
    }
    saveSiteSettingsDraft(draft)
    expect(loadSiteSettingsDraft()).toEqual(draft)
    const stored = Object.values(sessionStorage).join(" ").toLowerCase()
    expect(stored).not.toMatch(/password|token|bearer/)
    clearSiteSettingsDraft()
    expect(loadSiteSettingsDraft()).toBeNull()
  })

  it("ignores a broken draft", () => {
    sessionStorage.setItem("pos.siteSettingsDraft", "{not json")
    expect(loadSiteSettingsDraft()).toBeNull()
  })

  it("spots keys someone else saved meanwhile (value or last change)", () => {
    const draft = {
      edits: { "vat.standard-rate": "15.5", "pos.session.idle-lock-minutes": "8" },
      pendingReset: "board.done-display-minutes",
      baseline: buildBaseline(body.settings, ["vat.standard-rate", "pos.session.idle-lock-minutes", "board.done-display-minutes"]),
      reauthKeys: [],
    }
    const later = settingsBody({
      "vat.standard-rate": { value: 0.16, lastChange: { byName: "Other Admin", at: "2026-11-20T09:00:00Z", action: "SET" } },
      "board.done-display-minutes": { value: 10, isDefault: true, lastChange: { byName: "Other Admin", at: "2026-11-20T09:01:00Z", action: "RESET" } },
    })
    expect(staleKeys(draft, later.settings).sort()).toEqual(["board.done-display-minutes", "vat.standard-rate"])
    expect(staleKeys(draft, body.settings)).toEqual([])
  })
})

describe("API", () => {
  it("GET, PUT with only the changes, reset by key, history query", async () => {
    const authFetch = vi.fn(async (_path: string, _init?: RequestInit) => json(body))
    await fetchSiteSettings(authFetch)
    await saveSiteSettings(authFetch, { "pos.session.idle-lock-minutes": 10 })
    await resetSiteSetting(authFetch, "vat.standard-rate")
    expect(authFetch.mock.calls[0]).toEqual(["/admin/settings", undefined])
    expect(authFetch.mock.calls[1][0]).toBe("/admin/settings")
    expect(authFetch.mock.calls[1][1]).toMatchObject({ method: "PUT", body: JSON.stringify({ "pos.session.idle-lock-minutes": 10 }) })
    expect(authFetch.mock.calls[2]).toEqual(["/admin/settings/vat.standard-rate/reset", { method: "POST" }])
    expect(resetSettingPath("reports.close-day.first-trading-day")).toBe("/admin/settings/reports.close-day.first-trading-day/reset")
    expect(historyPath({ key: "vat.standard-rate", page: 2, size: 100 })).toBe("/admin/settings/history?key=vat.standard-rate&page=2&size=100")
    expect(historyPath({ key: null, page: -1, size: 50 })).toBe("/admin/settings/history?page=0&size=50")
  })

  it("reads a history page", async () => {
    const page = { content: [{ id: 42, key: "vat.standard-rate" }], page: 0, size: 50, totalElements: 1, totalPages: 1 }
    const result = await fetchSettingsHistory(vi.fn(async () => json(page)), { key: null, page: 0, size: 50 })
    expect(result.totalElements).toBe(1)
    expect(result.content).toHaveLength(1)
  })

  it("400: the field map, including body and unknown keys", async () => {
    const err = await saveSiteSettings(
      vi.fn(async () =>
        json(
          {
            "pos.session.idle-lock-minutes": "Must be at most the idle expiry time (30).",
            "pos.session.idle-expiry-minutes": "Must be at least the idle lock time (40).",
            "vat.standrad-rate": "Unknown setting.",
          },
          400,
        ),
      ),
      {},
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SiteSettingsError)
    expect((err as SiteSettingsError).fieldErrors).toEqual({
      "pos.session.idle-lock-minutes": "Must be at most the idle expiry time (30).",
      "pos.session.idle-expiry-minutes": "Must be at least the idle lock time (40).",
      "vat.standrad-rate": "Unknown setting.",
    })
    expect((err as SiteSettingsError).message).toBe("Nothing was saved. Check the highlighted settings.")
  })

  it("403 REAUTH_REQUIRED with the keys; 403 empty; 404 UNKNOWN_SETTING", async () => {
    const reauth = (await saveSiteSettings(
      vi.fn(async () => json({ error: "Sign in again…", code: "REAUTH_REQUIRED", details: { keys: ["vat.standard-rate"] } }, 403)),
      { "vat.standard-rate": 0.16 },
    ).catch((e: unknown) => e)) as SiteSettingsError
    expect(reauth.needsReauth).toBe(true)
    expect(reauth.reauthKeys).toEqual(["vat.standard-rate"])

    const forbidden = (await fetchSiteSettings(vi.fn(async () => new Response(null, { status: 403 }))).catch((e: unknown) => e)) as SiteSettingsError
    expect(forbidden.needsReauth).toBe(false)
    expect(forbidden.message).toBe("You don't have permission to change site settings.")

    const unknown = (await resetSiteSetting(
      vi.fn(async () => json({ error: "No such setting", code: "UNKNOWN_SETTING" }, 404)),
      "gone.key",
    ).catch((e: unknown) => e)) as SiteSettingsError
    expect(unknown.code).toBe("UNKNOWN_SETTING")
    expect(unknown.message).toBe("This setting no longer exists. The list has been reloaded.")
  })

  it("a network failure is a readable error", async () => {
    const err = (await fetchSiteSettings(vi.fn(async () => Promise.reject(new TypeError("fetch failed")))).catch((e: unknown) => e)) as SiteSettingsError
    expect(err.message).toMatch(/Can't reach the server/)
  })
})
