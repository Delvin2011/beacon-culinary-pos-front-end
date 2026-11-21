import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  EXPIRED_LINK_MESSAGE,
  INVALID_LINK_MESSAGE,
  InviteError,
  NETWORK_MESSAGE,
  PIN_IN_USE_MESSAGE,
  StaffInviteError,
  USED_LINK_MESSAGE,
  USED_LINK_SIGN_IN,
  acceptInvite,
  canRevokeInvite,
  formatInviteExpiry,
  inviteLink,
  inviteRequestBody,
  inviteStatusText,
  issueInvite,
  lookupInvite,
  offersPinWithReset,
  rateLimitedMessage,
  readHashToken,
  revokeInvite,
  signInDestination,
} from "@/lib/invites"
import { EXPIRES_AT, TOKEN, cashierLookup, errorResponse, issued, jsonResponse, staffInvite } from "@/lib/invites.test-fixtures"
import type { StaffRoleRule } from "@/lib/staff"

describe("readHashToken", () => {
  it("reads t from the hash", () => {
    expect(readHashToken(`#t=${TOKEN}`)).toEqual({ kind: "token", token: TOKEN })
    expect(readHashToken(`t=${TOKEN}`)).toEqual({ kind: "token", token: TOKEN })
  })

  it("is none with no hash or no t", () => {
    expect(readHashToken("")).toEqual({ kind: "none" })
    expect(readHashToken("#")).toEqual({ kind: "none" })
    expect(readHashToken("#other=1")).toEqual({ kind: "none" })
  })

  it("is malformed when the token is cut short, too long or has other characters", () => {
    expect(readHashToken("#t=")).toEqual({ kind: "malformed" })
    expect(readHashToken(`#t=${TOKEN.slice(0, 30)}`)).toEqual({ kind: "malformed" })
    expect(readHashToken(`#t=${TOKEN}x`)).toEqual({ kind: "malformed" })
    expect(readHashToken(`#t=${TOKEN.slice(0, 42)}!`)).toEqual({ kind: "malformed" })
  })
})

describe("inviteLink", () => {
  it("uses the API's link", () => {
    expect(inviteLink(issued(), "http://localhost:3000")).toBe(`https://pos.example.com/invite#t=${TOKEN}`)
  })

  it("builds it from this app's origin when link is null", () => {
    expect(inviteLink(issued({ link: null }), "http://localhost:3000")).toBe(`http://localhost:3000/invite#t=${TOKEN}`)
    expect(inviteLink(issued({ link: null }), "https://pos.local/")).toBe(`https://pos.local/invite#t=${TOKEN}`)
  })
})

describe("messages", () => {
  it("words a 429 with and without a wait", () => {
    expect(rateLimitedMessage(null)).toBe("Too many attempts. Try again in a few minutes.")
    expect(rateLimitedMessage(0)).toBe("Too many attempts. Try again in a few minutes.")
    expect(rateLimitedMessage(125)).toBe("Too many attempts. Try again in 2:05.")
  })

  it("shows the expiry in local time", () => {
    const local = new Date(EXPIRES_AT)
    const expected = `${local.getDate()} Nov 2026, ${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`
    expect(formatInviteExpiry(EXPIRES_AT)).toBe(expected)
    expect(formatInviteExpiry("not a date")).toBe("not a date")
  })
})

describe("public calls", () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("looks up with the token in the body only, no credentials, no cache, no referrer, no Authorization", async () => {
    fetchMock.mockResolvedValue(jsonResponse(cashierLookup))
    await expect(lookupInvite(TOKEN)).resolves.toEqual(cashierLookup)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/auth\/invites\/lookup$/)
    expect(url).not.toContain(TOKEN)
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN })
    expect(init.credentials).toBe("omit")
    expect(init.cache).toBe("no-store")
    expect(init.referrerPolicy).toBe("no-referrer")
    expect(init.headers).toEqual({ "Content-Type": "application/json" })
  })

  it("accepts with only the fields that are set", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ signInWith: "PIN", email: null }))
    await expect(acceptInvite(TOKEN, { pin: "123456", password: "" })).resolves.toEqual({ signInWith: "PIN", email: null })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/auth\/invites\/accept$/)
    expect(JSON.parse(init.body as string)).toEqual({ token: TOKEN, pin: "123456" })
  })

  async function refusal(res: Response): Promise<InviteError> {
    fetchMock.mockResolvedValue(res)
    const err = await lookupInvite(TOKEN).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InviteError)
    return err as InviteError
  }

  it("maps the link states by code", async () => {
    const invalid = await refusal(errorResponse(404, "INVITE_INVALID"))
    expect([invalid.message, invalid.linkState]).toEqual([INVALID_LINK_MESSAGE, "INVITE_INVALID"])
    const expired = await refusal(errorResponse(410, "INVITE_EXPIRED"))
    expect([expired.message, expired.linkState]).toEqual([EXPIRED_LINK_MESSAGE, "INVITE_EXPIRED"])
    const used = await refusal(errorResponse(410, "INVITE_USED"))
    expect([used.message, used.linkState]).toEqual([USED_LINK_MESSAGE, "INVITE_USED"])
  })

  it("branches on code, not on the text", async () => {
    const err = await refusal(errorResponse(410, "INVITE_EXPIRED", null, "This link has already been used."))
    expect(err.message).toBe(EXPIRED_LINK_MESSAGE)
  })

  it("puts details.fields under their fields", async () => {
    const err = await refusal(
      errorResponse(400, "INVITE_CREDENTIALS_INVALID", { fields: { password: "Too short.", pin: "Must be 6 digits.", junk: 3 } }),
    )
    expect(err.fields).toEqual({ password: "Too short.", pin: "Must be 6 digits." })
    expect(err.linkState).toBeNull()
  })

  it("puts PIN_IN_USE under the PIN", async () => {
    const err = await refusal(errorResponse(409, "PIN_IN_USE"))
    expect(err.fields).toEqual({ pin: PIN_IN_USE_MESSAGE })
  })

  it("reads a 429 from the body or Retry-After", async () => {
    const fromBody = await refusal(jsonResponse({ code: "RATE_LIMITED", message: "x", retryAfterSeconds: 90 }, 429))
    expect([fromBody.code, fromBody.retryAfterSeconds, fromBody.message]).toEqual(["RATE_LIMITED", 90, "Too many attempts. Try again in 1:30."])
    const fromHeader = await refusal(new Response("", { status: 429, headers: { "Retry-After": "30" } }))
    expect(fromHeader.retryAfterSeconds).toBe(30)
    const none = await refusal(new Response("", { status: 429 }))
    expect(none.message).toBe("Too many attempts. Try again in a few minutes.")
  })

  it("shows a code-less or unknown error's text as it is", async () => {
    expect((await refusal(errorResponse(500, null, null, "Database unavailable"))).message).toBe("Database unavailable")
    expect((await refusal(errorResponse(400, "SOMETHING_NEW", null, "New rule"))).message).toBe("New rule")
    expect((await refusal(new Response("", { status: 502 }))).message).toBe("Something went wrong. Try again.")
  })

  it("never puts the token in an error", async () => {
    fetchMock.mockRejectedValue(new TypeError(`Failed to fetch ${TOKEN}`))
    const err = (await lookupInvite(TOKEN).catch((e: unknown) => e)) as InviteError
    expect(err.code).toBe("NETWORK")
    expect(err.message).toBe(NETWORK_MESSAGE)
    expect(JSON.stringify(err)).not.toContain(TOKEN)
    expect(err.stack ?? "").not.toContain(TOKEN)
  })
})

describe("signInDestination", () => {
  it("sends a password sign-in to /login", () => {
    expect(signInDestination("PASSWORD", "ADMIN").href).toBe("/login")
    expect(signInDestination("PASSWORD", "HEAD_CHEF").href).toBe("/login")
  })

  it("sends a PIN sign-in to the role's screen", () => {
    expect(signInDestination("PIN", "CASHIER").href).toBe("/pos/login")
    expect(signInDestination("PIN", "ROLE_KITCHEN").href).toBe("/kitchen/login")
    expect(signInDestination("PIN", "barista").href).toBe("/bar/login")
  })

  it("points a used link at /login with a line for PIN users", () => {
    expect(USED_LINK_SIGN_IN.href).toBe("/login")
    expect(USED_LINK_SIGN_IN.hint).toBe("If you sign in with a PIN, use the till, kitchen or bar screen.")
  })
})

describe("staff screen helpers", () => {
  it("words each status", () => {
    expect(inviteStatusText(staffInvite("NONE"))).toBeNull()
    expect(inviteStatusText(staffInvite("USED"))).toBeNull()
    expect(inviteStatusText(staffInvite("PENDING"))).toBe(`Link sent, expires ${formatInviteExpiry(EXPIRES_AT)}`)
    expect(inviteStatusText(staffInvite("EXPIRED"))).toBe("Link expired")
    expect(inviteStatusText(staffInvite("REVOKED"))).toBe("Link revoked")
    expect(inviteStatusText(undefined)).toBeNull()
  })

  it("revokes only a pending or expired link", () => {
    expect(["NONE", "PENDING", "EXPIRED", "USED", "REVOKED"].map((s) => canRevokeInvite(staffInvite(s as never)))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ])
  })

  it("offers resetting the PIN too only when the PIN is optional", () => {
    const rule = (password: string, pin: string) => ({ role: "X", label: "X", password, pin }) as StaffRoleRule
    expect(offersPinWithReset(rule("REQUIRED", "OPTIONAL"))).toBe(true)
    expect(offersPinWithReset(rule("REQUIRED", "REQUIRED"))).toBe(false)
    expect(offersPinWithReset(rule("NONE", "REQUIRED"))).toBe(false)
    expect(offersPinWithReset(undefined)).toBe(false)
  })

  it("sends credentials only for a reset that includes the PIN", () => {
    expect(inviteRequestBody("STAFF_SETUP", true)).toEqual({ purpose: "STAFF_SETUP" })
    expect(inviteRequestBody("RESET", false)).toEqual({ purpose: "RESET" })
    expect(inviteRequestBody("RESET", true)).toEqual({ purpose: "RESET", credentials: "BOTH" })
  })
})

describe("admin calls", () => {
  const authFetch = vi.fn()
  beforeEach(() => authFetch.mockReset())

  it("issues a link", async () => {
    authFetch.mockResolvedValue(jsonResponse(issued(), 201))
    await expect(issueInvite(authFetch, 7, "RESET", true)).resolves.toEqual(issued())
    const [url, init] = authFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/admin/staff/7/invite")
    expect(JSON.parse(init.body as string)).toEqual({ purpose: "RESET", credentials: "BOTH" })
  })

  it("revokes a link and returns the person", async () => {
    authFetch.mockResolvedValue(jsonResponse({ id: 7, invite: staffInvite("REVOKED") }))
    await expect(revokeInvite(authFetch, 7)).resolves.toMatchObject({ id: 7 })
    expect(authFetch.mock.calls[0][0]).toBe("/admin/staff/7/invite/revoke")
  })

  async function staffRefusal(res: Response): Promise<StaffInviteError> {
    authFetch.mockResolvedValue(res)
    const err = await issueInvite(authFetch, 7, "STAFF_SETUP").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StaffInviteError)
    return err as StaffInviteError
  }

  it("maps each refusal by code", async () => {
    const reauth = await staffRefusal(errorResponse(403, "REAUTH_REQUIRED"))
    expect(reauth.needsReauth).toBe(true)
    expect((await staffRefusal(errorResponse(409, "INVITE_SELF"))).message).toBe("Change your own password or PIN from your profile.")
    expect((await staffRefusal(errorResponse(409, "INVITE_USER_INACTIVE"))).message).toBe("This person is deactivated. Activate them first.")
    expect((await staffRefusal(errorResponse(409, "INVITE_DEMO_ACCOUNT"))).message).toBe("Demo accounts can't get a link.")
    expect((await staffRefusal(new Response("", { status: 404 }))).message).toBe("This staff member no longer exists. Refresh the list.")
  })

  it("lists INVITE_REQUEST_INVALID's fields", async () => {
    const err = await staffRefusal(errorResponse(400, "INVITE_REQUEST_INVALID", { fields: { email: "They have no email.", credentials: "Not used." } }))
    expect(err.fields).toEqual({ email: "They have no email.", credentials: "Not used." })
    expect(err.message).toBe("Email: They have no email. Credentials: Not used.")
    expect(err.needsReauth).toBe(false)
  })

  it("words a revoke failure as a revoke", async () => {
    authFetch.mockResolvedValue(new Response("", { status: 500 }))
    await expect(revokeInvite(authFetch, 7)).rejects.toThrow("The link couldn't be revoked. Try again.")
  })
})
