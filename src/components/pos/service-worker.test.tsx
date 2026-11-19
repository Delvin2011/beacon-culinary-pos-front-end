// O3: the POS service worker is registered in production builds only, and a waiting update is activated only on the
// sign-in screen with no sale pending.
import { cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ServiceWorker } from "@/components/pos/service-worker"
import { PENDING_SALE_KEY } from "@/lib/pending-sale"
import { canActivateUpdate } from "@/lib/offline/sw-register"

let pathname = "/pos/login"
vi.mock("next/navigation", () => ({ usePathname: () => pathname }))

const postMessage = vi.fn()
const register = vi.fn()

function stubServiceWorker() {
  const registration = {
    waiting: { postMessage },
    installing: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  register.mockResolvedValue(registration)
  vi.stubGlobal("navigator", {
    ...navigator,
    serviceWorker: { register, controller: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  })
}

beforeEach(() => {
  pathname = "/pos/login"
  postMessage.mockReset()
  register.mockReset()
  localStorage.clear()
  stubServiceWorker()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

describe("service worker registration", () => {
  it("isn't registered outside a production build", async () => {
    render(<ServiceWorker />)
    await settle()
    expect(register).not.toHaveBeenCalled()
  })

  it("is registered at /sw.js in production, and a waiting update activates on the sign-in screen", async () => {
    vi.stubEnv("NODE_ENV", "production")
    render(<ServiceWorker />)
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" }))
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }))
  })

  it("never activates an update on the till itself", async () => {
    vi.stubEnv("NODE_ENV", "production")
    pathname = "/pos"
    render(<ServiceWorker />)
    await vi.waitFor(() => expect(register).toHaveBeenCalled())
    await settle()
    expect(postMessage).not.toHaveBeenCalled()
  })

  it("waits while a sale is pending, even on the sign-in screen", async () => {
    vi.stubEnv("NODE_ENV", "production")
    localStorage.setItem(PENDING_SALE_KEY, JSON.stringify({ pending: { clientOrderId: "c1" }, completedIds: [] }))
    render(<ServiceWorker />)
    await vi.waitFor(() => expect(register).toHaveBeenCalled())
    await settle()
    expect(postMessage).not.toHaveBeenCalled()
  })
})

describe("when an update may activate", () => {
  it("only on the sign-in screen, with no sale pending and the outbox empty (O4)", () => {
    expect(canActivateUpdate({ pathname: "/pos/login", salePending: false, outboxEmpty: true })).toBe(true)
    expect(canActivateUpdate({ pathname: "/pos", salePending: false, outboxEmpty: true })).toBe(false)
    expect(canActivateUpdate({ pathname: "/pos/login", salePending: true, outboxEmpty: true })).toBe(false)
    expect(canActivateUpdate({ pathname: "/pos/login", salePending: false, outboxEmpty: false })).toBe(false)
  })
})
