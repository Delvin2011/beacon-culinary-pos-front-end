import { describe, expect, it } from "vitest"
import { detailString, errorCode, readApiError } from "@/lib/api-error"

function response(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("readApiError", () => {
  it("reads an ErrorDto with details", async () => {
    const res = response(409, {
      error: "This serial number belongs to an active till.",
      code: "DEVICE_SERIAL_IN_USE",
      details: { deviceId: "d1", deviceName: "Till 1" },
    })
    expect(await readApiError(res)).toEqual({
      status: 409,
      code: "DEVICE_SERIAL_IN_USE",
      error: "This serial number belongs to an active till.",
      details: { deviceId: "d1", deviceName: "Till 1" },
      fieldErrors: {},
    })
  })

  it("reads an ErrorDto without details", async () => {
    const parsed = await readApiError(response(403, { error: "Sign in again.", code: "REAUTH_REQUIRED" }))
    expect(parsed.code).toBe("REAUTH_REQUIRED")
    expect(parsed.details).toBeNull()
  })

  it("reads a 400 field map", async () => {
    const parsed = await readApiError(response(400, { name: "Name is required", serialNumber: "Serial is required" }))
    expect(parsed.code).toBeNull()
    expect(parsed.fieldErrors).toEqual({ name: "Name is required", serialNumber: "Serial is required" })
  })

  it("handles an empty or malformed body (e.g. a 404)", async () => {
    expect(await readApiError(response(404, undefined))).toEqual({ status: 404, code: null, error: null, details: null, fieldErrors: {} })
    expect((await readApiError(response(500, "<html>oops</html>"))).code).toBeNull()
  })

  it("leaves the body readable for the caller", async () => {
    const res = response(409, { error: "x", code: "DEVICE_REVOKED" })
    await readApiError(res)
    expect(await res.json()).toMatchObject({ code: "DEVICE_REVOKED" })
  })
})

describe("errorCode / detailString", () => {
  it("returns the code of an error response only", async () => {
    expect(await errorCode(response(403, { error: "x", code: "DEVICE_NOT_REGISTERED" }))).toBe("DEVICE_NOT_REGISTERED")
    expect(await errorCode(response(200, { code: "DEVICE_NOT_REGISTERED" }))).toBeNull()
  })

  it("reads string details only", () => {
    expect(detailString({ deviceName: "Till 1", deviceId: 3 }, "deviceName")).toBe("Till 1")
    expect(detailString({ deviceId: 3 }, "deviceId")).toBeNull()
    expect(detailString(null, "deviceName")).toBeNull()
  })
})
