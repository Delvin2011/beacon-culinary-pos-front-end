// Test data for the T0-6b invite tests. Shapes from docs/2026-11-21-t0-6-invites-api-contract.md.
import type { InviteLookup, IssuedInvite, StaffInvite } from "@/lib/invites"

// 43 characters of A–Z a–z 0–9 - _.
export const TOKEN = "q3V9abcdefghijklmnopqrstuvwxyzABCDEFGHIJK-_"
export const OTHER_TOKEN = "Zz0000000000000000000000000000000000000000_"
export const EXPIRES_AT = "2026-11-24T10:15:00Z"

export const adminLookup: InviteLookup = {
  userName: "Lerato Dlamini",
  role: "ADMIN",
  roleLabel: "Admin",
  purpose: "FIRST_ADMIN",
  password: "REQUIRED",
  pin: "REQUIRED",
  signInWith: "PASSWORD",
  email: "lerato@example.com",
  expiresAt: EXPIRES_AT,
}

export const cashierLookup: InviteLookup = {
  userName: "Sipho Nkosi",
  role: "CASHIER",
  roleLabel: "Cashier",
  purpose: "STAFF_SETUP",
  password: "NONE",
  pin: "REQUIRED",
  signInWith: "PIN",
  email: null,
  expiresAt: EXPIRES_AT,
}

export const headChefLookup: InviteLookup = {
  userName: "Thandi Mokoena",
  role: "HEAD_CHEF",
  roleLabel: "Head Chef",
  purpose: "STAFF_SETUP",
  password: "REQUIRED",
  pin: "OPTIONAL",
  signInWith: "PASSWORD",
  email: "thandi@example.com",
  expiresAt: EXPIRES_AT,
}

export function issued(overrides: Partial<IssuedInvite> = {}): IssuedInvite {
  return { inviteId: 41, purpose: "STAFF_SETUP", credentials: "PIN", token: TOKEN, link: `https://pos.example.com/invite#t=${TOKEN}`, expiresAt: EXPIRES_AT, ...overrides }
}

export const NO_INVITE: StaffInvite = {
  status: "NONE",
  purpose: null,
  credentials: null,
  createdAt: null,
  expiresAt: null,
  usedAt: null,
  revokedAt: null,
}

export function staffInvite(status: StaffInvite["status"], overrides: Partial<StaffInvite> = {}): StaffInvite {
  if (status === "NONE") return { ...NO_INVITE, ...overrides }
  return {
    status,
    purpose: "STAFF_SETUP",
    credentials: "PIN",
    createdAt: "2026-11-21T10:15:00Z",
    expiresAt: EXPIRES_AT,
    usedAt: status === "USED" ? "2026-11-22T08:00:00Z" : null,
    revokedAt: status === "REVOKED" ? "2026-11-22T08:00:00Z" : null,
    ...overrides,
  }
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })
}

export function errorResponse(status: number, code: string | null, details: Record<string, unknown> | null = null, error = "Refused"): Response {
  return jsonResponse({ error, ...(code ? { code } : {}), ...(details ? { details } : {}) }, status)
}
