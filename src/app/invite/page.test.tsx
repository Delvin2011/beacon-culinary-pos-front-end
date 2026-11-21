// T0-6b: the invite page. The token comes from #t=, is cleared from the address bar before the first call, goes only
// in the bodies of the two invite POSTs, and is never stored, logged or sent with a bearer token.
import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import InvitePage from "@/app/invite/page"
import { metadata } from "@/app/invite/layout"
import { Providers } from "@/components/providers"
import { NO_TOKEN_MESSAGE, formatInviteExpiry } from "@/lib/invites"
import { EXPIRES_AT, TOKEN, adminLookup, cashierLookup, errorResponse, headChefLookup, jsonResponse } from "@/lib/invites.test-fixtures"
import { clearSignInEmail, peekSignInEmail } from "@/lib/sign-in-handoff"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/invite" }))

const fetchMock = vi.fn<typeof fetch>()
// The address bar at the moment of each request.
const hashAtCall: string[] = []
const consoleSpies: ReturnType<typeof vi.spyOn>[] = []

function openLink(hash: string) {
  window.history.replaceState({ next: "state" }, "", `/invite${hash}`)
}

function requests() {
  return fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), init: (init ?? {}) as RequestInit }))
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Save and finish" }))
}

beforeEach(() => {
  fetchMock.mockReset()
  hashAtCall.length = 0
  push.mockReset()
  clearSignInEmail()
  localStorage.clear()
  sessionStorage.clear()
  vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) => {
    hashAtCall.push(window.location.hash)
    return fetchMock(...args)
  })
  for (const method of ["log", "info", "warn", "error", "debug"] as const) consoleSpies.push(vi.spyOn(console, method))
})

afterEach(() => {
  // Nothing captured the token: no storage, no cookie, no console output, no URL, no history entry.
  const stored = [localStorage, sessionStorage].flatMap((s) => Object.keys(s).flatMap((k) => [k, s.getItem(k) ?? ""]))
  expect(stored.join(" ")).not.toContain(TOKEN)
  expect(document.cookie).not.toContain(TOKEN)
  for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN)
  expect(window.location.href).not.toContain(TOKEN)
  expect(JSON.stringify(window.history.state)).not.toContain(TOKEN)
  for (const { url, init } of requests()) {
    expect(url).not.toContain(TOKEN)
    expect(new Headers(init.headers).has("Authorization")).toBe(false)
    expect(init.credentials).toBe("omit")
    if (String(init.body ?? "").includes(TOKEN)) expect(url).toMatch(/\/auth\/invites\/(lookup|accept)$/)
  }
  // The hash was gone before every request.
  expect(hashAtCall.every((hash) => hash === "")).toBe(true)
  consoleSpies.splice(0).forEach((spy) => spy.mockRestore())
  vi.unstubAllGlobals()
})

describe("invite page", () => {
  it("clears the hash before looking up, keeping Next's history state", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(cashierLookup))
    render(<InvitePage />)
    await screen.findByText("Welcome, Sipho Nkosi. Set up your Cashier sign-in.")
    expect(window.location.hash).toBe("")
    expect(window.location.pathname).toBe("/invite")
    expect(window.history.state).toEqual({ next: "state" })
    expect(hashAtCall).toEqual([""])
    expect(JSON.parse(String(requests()[0].init.body))).toEqual({ token: TOKEN })
  })

  it("admin: sets a password and a PIN, then signs in with the email filled in", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(adminLookup)).mockResolvedValueOnce(jsonResponse({ signInWith: "PASSWORD", email: "lerato@example.com" }))
    render(<InvitePage />)
    await screen.findByText("Welcome, Lerato Dlamini. Set up your Admin sign-in.")
    expect(screen.getByText(`This link works once and expires ${formatInviteExpiry(EXPIRES_AT)}.`)).toBeInTheDocument()

    type("New password", "secret-pass")
    type("Confirm password", "secret-pass")
    type("New PIN", "246810")
    type("Confirm PIN", "246810")
    submit()

    await screen.findByText("You're all set. Sign in with your new details.")
    const accept = requests()[1]
    expect(accept.url).toMatch(/\/auth\/invites\/accept$/)
    expect(JSON.parse(String(accept.init.body))).toEqual({ token: TOKEN, password: "secret-pass", pin: "246810" })

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(push).toHaveBeenCalledWith("/login")
    expect(peekSignInEmail()).toBe("lerato@example.com")
  })

  it("cashier: PIN only, then the POS sign-in", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(cashierLookup)).mockResolvedValueOnce(jsonResponse({ signInWith: "PIN", email: null }))
    render(<InvitePage />)
    await screen.findByLabelText("New PIN")
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument()

    type("New PIN", "135790")
    type("Confirm PIN", "135790")
    submit()

    await screen.findByText("You're all set. Sign in with your new details.")
    expect(JSON.parse(String(requests()[1].init.body))).toEqual({ token: TOKEN, pin: "135790" })
    expect(screen.getByText("Sign in at a till: tap your name, then enter your PIN.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Go to the POS sign-in" }))
    expect(push).toHaveBeenCalledWith("/pos/login")
    expect(peekSignInEmail()).toBeNull()
  })

  it("head chef: a password with the optional PIN left empty", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(headChefLookup)).mockResolvedValueOnce(jsonResponse({ signInWith: "PASSWORD", email: "thandi@example.com" }))
    render(<InvitePage />)
    await screen.findByText("PIN (optional)")
    expect(screen.getByText(/Leave both boxes empty if you don't want a PIN/)).toBeInTheDocument()

    type("New password", "kitchen-1")
    type("Confirm password", "kitchen-1")
    submit()

    await screen.findByText("You're all set. Sign in with your new details.")
    expect(JSON.parse(String(requests()[1].init.body))).toEqual({ token: TOKEN, password: "kitchen-1" })
  })

  it("checks the confirmations in the browser", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(adminLookup))
    render(<InvitePage />)
    await screen.findByLabelText("New password")

    type("New password", "secret-pass")
    type("Confirm password", "secret-pasz")
    type("New PIN", "246810")
    type("Confirm PIN", "246811")
    submit()

    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument()
    expect(screen.getByText("The PINs don't match.")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    type("New password", "short")
    type("Confirm password", "short")
    type("New PIN", "")
    type("Confirm PIN", "")
    submit()
    expect(await screen.findByText("Password must be between 6 and 25 characters.")).toBeInTheDocument()
    expect(screen.getByText("PIN is required.")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("shows details.fields under each field, and the link still works", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock
      .mockResolvedValueOnce(jsonResponse(adminLookup))
      .mockResolvedValueOnce(errorResponse(400, "INVITE_CREDENTIALS_INVALID", { fields: { password: "Too common.", pin: "Too simple." } }))
    render(<InvitePage />)
    await screen.findByLabelText("New password")
    type("New password", "password1")
    type("Confirm password", "password1")
    type("New PIN", "123456")
    type("Confirm PIN", "123456")
    submit()

    expect(await screen.findByText("Too common.")).toBeInTheDocument()
    expect(screen.getByText("Too simple.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save and finish" })).toBeEnabled()

    type("New PIN", "97531")
    expect(screen.queryByText("Too simple.")).not.toBeInTheDocument()
    expect(screen.getByText("Too common.")).toBeInTheDocument()
  })

  it("PIN_IN_USE: Choose a different PIN.", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(adminLookup)).mockResolvedValueOnce(errorResponse(409, "PIN_IN_USE"))
    render(<InvitePage />)
    await screen.findByLabelText("New password")
    type("New password", "secret-pass")
    type("Confirm password", "secret-pass")
    type("New PIN", "246810")
    type("Confirm PIN", "246810")
    submit()
    expect(await screen.findByText("Choose a different PIN.")).toBeInTheDocument()
  })

  it.each([
    [404, "INVITE_INVALID", "This link isn't valid. Ask a manager for a new one."],
    [410, "INVITE_EXPIRED", "This link has expired. Ask a manager for a new one."],
  ])("lookup %s %s", async (status, code, message) => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(errorResponse(status, code))
    render(<InvitePage />)
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("a used link offers a sign-in button and a line for PIN users", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(errorResponse(410, "INVITE_USED"))
    render(<InvitePage />)
    expect(await screen.findByText("This link has already been used.")).toBeInTheDocument()
    expect(screen.getByText("If you sign in with a PIN, use the till, kitchen or bar screen.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(push).toHaveBeenCalledWith("/login")
  })

  it("a link that expires while the form is open replaces the form", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(cashierLookup)).mockResolvedValueOnce(errorResponse(410, "INVITE_EXPIRED"))
    render(<InvitePage />)
    await screen.findByLabelText("New PIN")
    type("New PIN", "135790")
    type("Confirm PIN", "135790")
    submit()
    expect(await screen.findByText("This link has expired. Ask a manager for a new one.")).toBeInTheDocument()
    expect(screen.queryByLabelText("New PIN")).not.toBeInTheDocument()
  })

  it("429 on lookup: shows the wait, and Try again uses the token kept in memory", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "120" } }))
      .mockResolvedValueOnce(jsonResponse(cashierLookup))
    render(<InvitePage />)
    expect(await screen.findByText("Too many attempts. Try again in 2:00.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await screen.findByLabelText("New PIN")
    expect(JSON.parse(String(requests()[1].init.body))).toEqual({ token: TOKEN })
  })

  it("429 on accept without Retry-After", async () => {
    openLink(`#t=${TOKEN}`)
    fetchMock.mockResolvedValueOnce(jsonResponse(cashierLookup)).mockResolvedValueOnce(new Response("", { status: 429 }))
    render(<InvitePage />)
    await screen.findByLabelText("New PIN")
    type("New PIN", "135790")
    type("Confirm PIN", "135790")
    submit()
    expect(await screen.findByText("Too many attempts. Try again in a few minutes.")).toBeInTheDocument()
  })

  it("no token (e.g. a refresh after the hash was cleared): says to open the link again, calls nothing", async () => {
    openLink("")
    render(<InvitePage />)
    expect(await screen.findByText(NO_TOKEN_MESSAGE)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("a malformed token is invalid without a call, and is cleared too", async () => {
    openLink("#t=abc")
    render(<InvitePage />)
    expect(await screen.findByText("This link isn't valid. Ask a manager for a new one.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.location.hash).toBe("")
  })

  it("runs outside the app's auth providers and loads nothing from another site", async () => {
    openLink(`#t=${TOKEN}`)
    localStorage.setItem("bar-talk.auth", JSON.stringify({ token: "a.b.c", user: { email: "admin@x.co" } }))
    fetchMock.mockResolvedValueOnce(jsonResponse(cashierLookup))
    const { container } = render(
      <Providers>
        <InvitePage />
      </Providers>,
    )
    await screen.findByLabelText("New PIN")
    // The stored session's bearer token isn't sent (checked in afterEach), and nothing external is loaded.
    expect(container.querySelectorAll("script, link, iframe, img[src^='http']")).toHaveLength(0)
    localStorage.clear()
  })

  it("sends no Referer and stays out of search results", () => {
    expect(metadata.referrer).toBe("no-referrer")
    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
