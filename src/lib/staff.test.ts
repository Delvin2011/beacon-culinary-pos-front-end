import { afterEach, describe, expect, it, vi } from "vitest"
import {
  activeBlocks,
  blockLabel,
  isLocked,
  isOwnRecord,
  lockLabel,
  lockedScopes,
  needsUnlock,
  unlockStaff,
  type StaffBlock,
  type StaffLock,
  type StaffMember,
} from "@/lib/staff"

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})

const unlocked: StaffLock = { locked: false, lockedUntil: null, requiresAdminUnlock: false }

function member(locks?: StaffMember["locks"]): StaffMember {
  return { id: 1, name: "Ann Lee", email: null, role: "CASHIER", active: true, hasPassword: false, hasPin: true, locks }
}

describe("lockedScopes / isLocked", () => {
  it("is empty when locks are missing or all false", () => {
    expect(lockedScopes(member())).toEqual([])
    expect(isLocked(member({ PASSWORD: unlocked, PIN: unlocked }))).toBe(false)
  })

  it("lists locked scopes, password first", () => {
    const pin: StaffLock = { locked: true, lockedUntil: null, requiresAdminUnlock: true }
    const password: StaffLock = { locked: true, lockedUntil: "2026-11-12T10:00:00Z", requiresAdminUnlock: false }
    expect(lockedScopes(member({ PIN: pin, PASSWORD: password }))).toEqual([
      { scope: "PASSWORD", lock: password },
      { scope: "PIN", lock: pin },
    ])
    expect(isLocked(member({ PIN: pin }))).toBe(true)
  })
})

describe("activeBlocks / needsUnlock", () => {
  const notBlocked: StaffBlock = { blocked: false, blockedUntil: null }
  const pinBlock: StaffBlock = { blocked: true, blockedUntil: "2026-11-13T10:41:00Z" }

  it("finds nothing without blocks or when everything is false", () => {
    expect(activeBlocks(member())).toEqual([])
    expect(needsUnlock(member())).toBe(false)
    const clear = { ...member(), blocks: { PIN: notBlocked, MANAGER_PIN: notBlocked, CHANGE_PASSWORD: notBlocked } }
    expect(activeBlocks(clear)).toEqual([])
    expect(needsUnlock(clear)).toBe(false)
  })

  it("lists active blocks in a fixed order", () => {
    const managerBlock: StaffBlock = { blocked: true, blockedUntil: null }
    const blocked = { ...member(), blocks: { MANAGER_PIN: managerBlock, PIN: pinBlock, CHANGE_PASSWORD: notBlocked } }
    expect(activeBlocks(blocked)).toEqual([
      { scope: "PIN", block: pinBlock },
      { scope: "MANAGER_PIN", block: managerBlock },
    ])
  })

  it("needs unlocking for a block alone or a lock alone", () => {
    expect(needsUnlock({ ...member(), blocks: { PIN: pinBlock } })).toBe(true)
    expect(needsUnlock(member({ PIN: { locked: true, lockedUntil: null, requiresAdminUnlock: true } }))).toBe(true)
  })
})

describe("blockLabel", () => {
  it("words each scope in local time", () => {
    process.env.TZ = "Africa/Johannesburg"
    const now = new Date("2026-11-13T10:00:00Z")
    const block: StaffBlock = { blocked: true, blockedUntil: "2026-11-13T10:41:00Z" }
    expect(blockLabel("PIN", block, now)).toBe("PIN blocked at a till until 12:41")
    expect(blockLabel("MANAGER_PIN", block, now)).toBe("Manager PIN blocked until 12:41")
    expect(blockLabel("CHANGE_PASSWORD", block, now)).toBe("Password change blocked until 12:41")
  })

  it("adds the date when it isn't today, and leaves out a missing time", () => {
    process.env.TZ = "Africa/Johannesburg"
    const lateBlock: StaffBlock = { blocked: true, blockedUntil: "2026-11-13T22:05:00Z" }
    expect(blockLabel("PIN", lateBlock, new Date("2026-11-13T21:55:00Z"))).toBe("PIN blocked at a till until 14 Nov 00:05")
    expect(blockLabel("PIN", { blocked: true, blockedUntil: null })).toBe("PIN blocked at a till")
  })
})

describe("isOwnRecord", () => {
  const admin: StaffMember = { ...member(), id: 10010, email: "Chef@Example.com", role: "ADMIN" }

  it("matches the signed-in email, ignoring case and spaces", () => {
    expect(isOwnRecord(admin, { email: " chef@example.com " })).toBe(true)
  })

  it("matches the cashier ID after a PIN sign-in", () => {
    expect(isOwnRecord(admin, { email: "10010", cashierId: 10010 })).toBe(true)
  })

  it("doesn't match someone else, or nobody", () => {
    expect(isOwnRecord(admin, { email: "other@example.com" })).toBe(false)
    expect(isOwnRecord(admin, { email: "7", cashierId: 7 })).toBe(false)
    expect(isOwnRecord({ ...admin, email: null }, { email: "chef@example.com" })).toBe(false)
    expect(isOwnRecord(admin, null)).toBe(false)
  })
})

describe("lockLabel", () => {
  it("shows lockedUntil in local time", () => {
    process.env.TZ = "Africa/Johannesburg"
    const lock: StaffLock = { locked: true, lockedUntil: "2026-11-12T12:32:00Z", requiresAdminUnlock: false }
    expect(lockLabel("PASSWORD", lock, new Date("2026-11-12T12:00:00Z"))).toBe("Password locked until 14:32")
  })

  it("adds the date when it isn't today", () => {
    process.env.TZ = "Africa/Johannesburg"
    const lock: StaffLock = { locked: true, lockedUntil: "2026-11-12T22:30:00Z", requiresAdminUnlock: false }
    expect(lockLabel("PIN", lock, new Date("2026-11-12T21:50:00Z"))).toBe("PIN locked until 13 Nov 00:30")
  })

  it("says when an admin must unlock", () => {
    expect(lockLabel("PIN", { locked: true, lockedUntil: null, requiresAdminUnlock: true })).toBe("PIN locked: needs unlock")
  })

  it("falls back when the time is missing or invalid", () => {
    expect(lockLabel("PASSWORD", { locked: true, lockedUntil: null, requiresAdminUnlock: false })).toBe("Password locked")
    expect(lockLabel("PASSWORD", { locked: true, lockedUntil: "soon", requiresAdminUnlock: false })).toBe("Password locked")
  })
})

describe("unlockStaff", () => {
  const ok = member({ PASSWORD: unlocked, PIN: unlocked })

  it("posts with no body and returns the updated record", async () => {
    const authFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(ok), { status: 200 }))
    expect(await unlockStaff(authFetch, 1)).toEqual(ok)
    expect(authFetch).toHaveBeenCalledWith("/admin/staff/1/unlock", { method: "POST" })
  })

  it.each([
    [404, null, "This staff member no longer exists. Refresh the list."],
    [400, { scope: "Unknown scope" }, "The unlock request was refused. Refresh the list and try again."],
    [403, null, "Only admins can manage staff."],
    [409, { error: "Admins can't unlock themselves.", code: "SELF_UNLOCK" }, "You can't unlock your own sign-in. Ask another admin to unlock it."],
    [500, null, "Unable to unlock this person. Try again."],
  ])("explains a %i plainly", async (status, body, message) => {
    const authFetch = vi.fn().mockResolvedValue(new Response(body ? JSON.stringify(body) : null, { status }))
    await expect(unlockStaff(authFetch, 1)).rejects.toThrow(message)
  })
})
