// T0-6b invite links (contract docs/2026-11-21-t0-6-invites-api-contract.md).
//
// The token rules, everywhere:
// - The link is {origin}/invite#t=<token>. The token is never put in a path or query string.
// - It is never stored (no localStorage, sessionStorage, IndexedDB, cookies or persisted store) and never logged.
// - It is sent only in the bodies of POST /auth/invites/lookup and POST /auth/invites/accept, which use a plain
//   fetch: no bearer token, no cookies, no refresh-on-401, no redirect handling.
// - Nothing in this file puts the token in an error, a message or anything else that outlives the call.
//
// Branch on `code` (and details.fields) only, never on the error text.

import { format } from "date-fns"
import { readApiError } from "@/lib/api-error"
import { formatWait, readLoginBlock } from "@/lib/login-protection"
import type { CredentialRule, StaffMember, StaffRoleRule } from "@/lib/staff"
import { apiFetch } from "@/lib/api-fetch"

export type InvitePurpose = "FIRST_ADMIN" | "STAFF_SETUP" | "RESET"
export type SignInWith = "PASSWORD" | "PIN"
export type InviteCredentials = "PASSWORD" | "PIN" | "BOTH"
export type InviteStatus = "NONE" | "PENDING" | "EXPIRED" | "USED" | "REVOKED"

// POST /auth/invites/lookup 200.
export interface InviteLookup {
  userName: string
  role: string
  roleLabel: string
  purpose: InvitePurpose
  password: CredentialRule
  pin: CredentialRule
  signInWith: SignInWith
  // Only when signInWith is PASSWORD.
  email: string | null
  expiresAt: string
}

// POST /auth/invites/accept 200. No role: keep the lookup's.
export interface InviteAcceptResult {
  signInWith: SignInWith
  email: string | null
}

// POST /admin/staff/{id}/invite 201, and issuedInvite on a create with setup INVITE. Shown once.
export interface IssuedInvite {
  inviteId: number
  purpose: InvitePurpose
  credentials: InviteCredentials
  token: string
  link: string | null
  expiresAt: string
}

// Every staff response's `invite`: never null; with NONE every other field is null.
export interface StaffInvite {
  status: InviteStatus
  purpose: InvitePurpose | null
  credentials: InviteCredentials | null
  createdAt: string | null
  expiresAt: string | null
  usedAt: string | null
  revokedAt: string | null
}

// ---------- The token in the link ----------

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type HashToken = { kind: "token"; token: string } | { kind: "none" } | { kind: "malformed" }

// Reads t from a location.hash ("#t=..."). "none": no token at all (e.g. the page was refreshed after the hash was
// cleared); "malformed": something is there but it can't be a token (e.g. the link was cut short when pasted).
export function readHashToken(hash: string): HashToken {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw) return { kind: "none" }
  const token = new URLSearchParams(raw).get("t")
  if (token === null || token === "") return raw.includes("t=") ? { kind: "malformed" } : { kind: "none" }
  return TOKEN_PATTERN.test(token) ? { kind: "token", token } : { kind: "malformed" }
}

// The link to send: the API's link, or this app's own address when the API has no public base URL set.
export function inviteLink(issued: Pick<IssuedInvite, "link" | "token">, origin: string): string {
  return issued.link ?? `${origin.replace(/\/+$/, "")}/invite#t=${issued.token}`
}

// ---------- Messages ----------

export const NO_TOKEN_MESSAGE =
  "This link can only be opened once from the original message. Open the link again, or ask a manager for a new one."
export const INVALID_LINK_MESSAGE = "This link isn't valid. Ask a manager for a new one."
export const EXPIRED_LINK_MESSAGE = "This link has expired. Ask a manager for a new one."
export const USED_LINK_MESSAGE = "This link has already been used."
export const PIN_IN_USE_MESSAGE = "Choose a different PIN."
export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again."
const FALLBACK_MESSAGE = "Something went wrong. Try again."

export function rateLimitedMessage(retryAfterSeconds: number | null): string {
  return retryAfterSeconds !== null && retryAfterSeconds > 0
    ? `Too many attempts. Try again in ${formatWait(retryAfterSeconds)}.`
    : "Too many attempts. Try again in a few minutes."
}

// The link's expiry in the viewer's local time, e.g. "24 Nov 2026, 12:15".
export function formatInviteExpiry(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : format(date, "d MMM yyyy, HH:mm")
}

// ---------- Public calls (the invite page) ----------

// Codes the invite page shows as a whole-page state rather than next to a field.
export type InviteLinkState = "INVITE_INVALID" | "INVITE_EXPIRED" | "INVITE_USED"

export class InviteError extends Error {
  readonly status: number
  // The response's code; "RATE_LIMITED" for any 429, "NETWORK" when the server couldn't be reached.
  readonly code: string | null
  // details.fields from INVITE_CREDENTIALS_INVALID (and "pin" for PIN_IN_USE).
  readonly fields: Record<string, string>
  readonly retryAfterSeconds: number | null

  constructor(message: string, status: number, code: string | null, fields: Record<string, string> = {}, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = "InviteError"
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfterSeconds = retryAfterSeconds
  }

  // A state that replaces the form: the link can't be used.
  get linkState(): InviteLinkState | null {
    return this.code === "INVITE_INVALID" || this.code === "INVITE_EXPIRED" || this.code === "INVITE_USED" ? this.code : null
  }
}

function fieldMessages(details: Record<string, unknown> | null): Record<string, string> {
  const raw = details?.fields
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const fields: Record<string, string> = {}
  for (const [field, message] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof message === "string" && message.trim()) fields[field] = message
  }
  return fields
}

async function publicInviteError(res: Response): Promise<InviteError> {
  const block = await readLoginBlock(res)
  if (block) return new InviteError(rateLimitedMessage(block.retryAfterSeconds), 429, "RATE_LIMITED", {}, block.retryAfterSeconds)

  const { status, code, error, details } = await readApiError(res)
  switch (code) {
    case "INVITE_INVALID":
      return new InviteError(INVALID_LINK_MESSAGE, status, code)
    case "INVITE_EXPIRED":
      return new InviteError(EXPIRED_LINK_MESSAGE, status, code)
    case "INVITE_USED":
      return new InviteError(USED_LINK_MESSAGE, status, code)
    case "PIN_IN_USE":
      return new InviteError(PIN_IN_USE_MESSAGE, status, code, { pin: PIN_IN_USE_MESSAGE })
    case "INVITE_CREDENTIALS_INVALID": {
      const fields = fieldMessages(details)
      return new InviteError(error ?? "Check the details below.", status, code, fields)
    }
    default:
      // An unknown code, or none: show the server's text as it is.
      return new InviteError(error ?? FALLBACK_MESSAGE, status, code)
  }
}

// A plain fetch: no Authorization header, no cookies (so no refresh cookie), not cached, no Referer.
async function postPublic<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await apiFetch(path, {
      timeoutMs: null,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
  } catch {
    throw new InviteError(NETWORK_MESSAGE, 0, "NETWORK")
  }
  if (!res.ok) throw await publicInviteError(res)
  return (await res.json()) as T
}

export function lookupInvite(token: string): Promise<InviteLookup> {
  return postPublic<InviteLookup>("/auth/invites/lookup", { token })
}

// Sends only what is set: a blank optional field is left out.
export function acceptInvite(token: string, credentials: { password?: string; pin?: string }): Promise<InviteAcceptResult> {
  return postPublic<InviteAcceptResult>("/auth/invites/accept", {
    token,
    ...(credentials.password ? { password: credentials.password } : {}),
    ...(credentials.pin ? { pin: credentials.pin } : {}),
  })
}

// ---------- After accepting: where to sign in ----------

export interface SignInDestination {
  href: string
  label: string
  // Shown under the button.
  hint: string | null
}

function normaliseRole(role: string | null | undefined): string {
  return (role ?? "").toUpperCase().replace(/^ROLE_/, "")
}

// PASSWORD: the back-office sign-in. PIN: the screen the role uses its PIN on.
export function signInDestination(signInWith: SignInWith, role: string): SignInDestination {
  if (signInWith === "PASSWORD") return { href: "/login", label: "Sign in", hint: null }
  switch (normaliseRole(role)) {
    case "CASHIER":
      return { href: "/pos/login", label: "Go to the POS sign-in", hint: "Sign in at a till: tap your name, then enter your PIN." }
    case "KITCHEN":
      return { href: "/kitchen/login", label: "Go to the kitchen display", hint: "Tap your name on the kitchen display, then enter your PIN." }
    case "BARISTA":
      return { href: "/bar/login", label: "Go to the bar display", hint: "Tap your name on the bar display, then enter your PIN." }
    default:
      return { href: "/pos/login", label: "Go to the PIN sign-in", hint: "Tap your name, then enter your PIN." }
  }
}

// A used link says nothing about how the person signs in (the 410 is only {error, code}).
export const USED_LINK_SIGN_IN: SignInDestination = {
  href: "/login",
  label: "Sign in",
  hint: "If you sign in with a PIN, use the till, kitchen or bar screen.",
}

// ---------- Staff screen (ADMIN) ----------

// The line under a person on the staff screen; null for NONE and USED.
export function inviteStatusText(invite: StaffInvite | null | undefined): string | null {
  switch (invite?.status) {
    case "PENDING":
      return invite.expiresAt ? `Link sent, expires ${formatInviteExpiry(invite.expiresAt)}` : "Link sent"
    case "EXPIRED":
      return "Link expired"
    case "REVOKED":
      return "Link revoked"
    default:
      return null
  }
}

export function canRevokeInvite(invite: StaffInvite | null | undefined): boolean {
  return invite?.status === "PENDING" || invite?.status === "EXPIRED"
}

// "Also reset the PIN" is offered on a reset for a role whose PIN is optional (Head Chef): a reset otherwise covers
// only what the role requires.
export function offersPinWithReset(rule: StaffRoleRule | undefined): boolean {
  return rule?.pin === "OPTIONAL" && rule.password !== "NONE"
}

// The request body. credentials is left out unless the admin asked to reset the optional PIN too.
export function inviteRequestBody(purpose: "STAFF_SETUP" | "RESET", alsoResetPin: boolean): { purpose: string; credentials?: InviteCredentials } {
  return purpose === "RESET" && alsoResetPin ? { purpose, credentials: "BOTH" } : { purpose }
}

export class StaffInviteError extends Error {
  readonly status: number
  readonly code: string | null
  readonly fields: Record<string, string>

  constructor(message: string, status: number, code: string | null, fields: Record<string, string> = {}) {
    super(message)
    this.name = "StaffInviteError"
    this.status = status
    this.code = code
    this.fields = fields
  }

  // An ADMIN's link: sign in again with the password, then retry.
  get needsReauth(): boolean {
    return this.code === "REAUTH_REQUIRED"
  }
}

const INVITE_REQUEST_FIELD_LABEL: Record<string, string> = { purpose: "Purpose", credentials: "Credentials", email: "Email" }

export async function staffInviteError(res: Response, action: "send" | "revoke" = "send"): Promise<StaffInviteError> {
  const { status, code, error, details } = await readApiError(res)
  const failed = action === "send" ? "The link couldn't be sent." : "The link couldn't be revoked."
  switch (code) {
    case "REAUTH_REQUIRED":
      return new StaffInviteError("Sign in again with your password, then try again.", status, code)
    case "INVITE_SELF":
      return new StaffInviteError("Change your own password or PIN from your profile.", status, code)
    case "INVITE_USER_INACTIVE":
      return new StaffInviteError("This person is deactivated. Activate them first.", status, code)
    case "INVITE_DEMO_ACCOUNT":
      return new StaffInviteError("Demo accounts can't get a link.", status, code)
    case "INVITE_REQUEST_INVALID": {
      const fields = fieldMessages(details)
      const lines = Object.entries(fields).map(([field, message]) => `${INVITE_REQUEST_FIELD_LABEL[field] ?? field}: ${message}`)
      return new StaffInviteError(lines.length > 0 ? lines.join(" ") : error ?? failed, status, code, fields)
    }
  }
  if (status === 404 && code === null) return new StaffInviteError("This staff member no longer exists. Refresh the list.", status, code)
  if (status === 403) return new StaffInviteError(error ?? "Only admins can manage sign-in links.", status, code)
  return new StaffInviteError(error ?? `${failed} Try again.`, status, code)
}

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>

export async function issueInvite(authFetch: AuthFetch, staffId: number, purpose: "STAFF_SETUP" | "RESET", alsoResetPin = false): Promise<IssuedInvite> {
  const res = await authFetch(`/admin/staff/${staffId}/invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(inviteRequestBody(purpose, alsoResetPin)),
  })
  if (!res.ok) throw await staffInviteError(res)
  return (await res.json()) as IssuedInvite
}

export async function revokeInvite(authFetch: AuthFetch, staffId: number): Promise<StaffMember> {
  const res = await authFetch(`/admin/staff/${staffId}/invite/revoke`, { method: "POST" })
  if (!res.ok) throw await staffInviteError(res, "revoke")
  return (await res.json()) as StaffMember
}
