import { useContext, type ContextType } from "react"
import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  AuthContext,
  AuthProvider,
  DeviceNotRegisteredError,
  INCORRECT_PIN_MESSAGE,
  PIN_LOGIN_FAILED_MESSAGE,
  PinLoginError,
} from "@/contexts/auth-context"
import { PIN_FORMAT_MESSAGE } from "@/lib/pin"

type Auth = NonNullable<ContextType<typeof AuthContext>>

function renderAuth(): () => Auth {
  let current: Auth | undefined
  function Probe() {
    current = useContext(AuthContext)
    return null
  }
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
  return () => current as Auth
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function pinLoginError(auth: () => Auth, pin: string): Promise<PinLoginError> {
  let caught: unknown
  await act(async () => {
    await auth()
      .pinLogin({ cashierId: 7, pin })
      .catch((err: unknown) => {
        caught = err
      })
  })
  expect(caught).toBeInstanceOf(PinLoginError)
  return caught as PinLoginError
}

const fetchMock = vi.fn<typeof fetch>()

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("pinLogin", () => {
  it.each(["12345", "1234567", "12345a", ""])("refuses %j without calling the backend", async (pin) => {
    const auth = renderAuth()
    const err = await pinLoginError(auth, pin)
    expect(err.message).toBe(PIN_FORMAT_MESSAGE)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auth().error).toBe(PIN_FORMAT_MESSAGE)
  })

  it("shows Incorrect PIN for a 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, undefined))
    const auth = renderAuth()
    expect((await pinLoginError(auth, "123456")).message).toBe(INCORRECT_PIN_MESSAGE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("shows the format message for the backend's 400", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { pin: "PIN must be 6 digits" }))
    const auth = renderAuth()
    expect((await pinLoginError(auth, "123456")).message).toBe(PIN_FORMAT_MESSAGE)
  })

  it("never shows the backend's own text for other errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: "Cashier 7 does not exist" }))
    const auth = renderAuth()
    expect((await pinLoginError(auth, "123456")).message).toBe(PIN_LOGIN_FAILED_MESSAGE)
    expect(auth().error).toBe(PIN_LOGIN_FAILED_MESSAGE)
  })

  it("shows the generic message for a network error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const auth = renderAuth()
    expect((await pinLoginError(auth, "123456")).message).toBe(PIN_LOGIN_FAILED_MESSAGE)
  })

  it("signs in with a valid 6-digit PIN", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: "a.b.c" }))
    const auth = renderAuth()
    await act(async () => {
      await auth().pinLogin({ cashierId: 7, pin: "123456" })
    })
    expect(auth().isAuthenticated).toBe(true)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ cashierId: 7, pin: "123456" })
  })
})

describe("pinLogin on an unregistered till", () => {
  it("throws DeviceNotRegisteredError with the fixed message, never the body's text", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "Cashier 7 exists but this till is unknown", code: "DEVICE_NOT_REGISTERED" }))
    const auth = renderAuth()
    const err = await pinLoginError(auth, "123456")
    expect(err).toBeInstanceOf(DeviceNotRegisteredError)
    expect(err.message).toBe("This till is not registered. Ask a manager to register it.")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("gives the generic message for a 403 with another code", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: "Nope", code: "SOMETHING_ELSE" }))
    const auth = renderAuth()
    const err = await pinLoginError(auth, "123456")
    expect(err).not.toBeInstanceOf(DeviceNotRegisteredError)
    expect(err.message).toBe(PIN_LOGIN_FAILED_MESSAGE)
  })
})
