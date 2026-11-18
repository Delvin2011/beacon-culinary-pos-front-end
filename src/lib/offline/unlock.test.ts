// O3 (D13): the offline unlock check value: PBKDF2-SHA256, never the PIN; when it is made at sign-in.
import "fake-indexeddb/auto"
import { deleteDB } from "idb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OFFLINE_DB_NAME, getMeta, getUnlockVerifier, resetOfflineDbForTests, setMeta } from "@/lib/offline/db"
import {
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  calibrateIterations,
  checkUnlockPin,
  createUnlockVerifier,
  iterationsFor,
  saveUnlockVerifierAfterSignIn,
} from "@/lib/offline/unlock"
import type { TillStatus } from "@/lib/till"

const tillStatus: TillStatus = {
  registered: true,
  tillCode: "T1",
  tillName: "Till 1",
  shift: { shiftId: 412, ownerId: 17, ownerName: "Thandi Mokoena", openedAt: "2026-11-18T05:58:12Z", locked: false },
  idleLockMinutes: 5,
  requireRegistered: false,
  offlineEnabled: true,
  maxOfflineHours: 6,
  warnOfflineHours: 5,
}

beforeEach(async () => {
  await resetOfflineDbForTests()
  await deleteDB(OFFLINE_DB_NAME)
  // Keep the tests fast: a stored calibration.
  await setMeta("unlockIterations", 1_000)
})

afterEach(async () => {
  await resetOfflineDbForTests()
})

describe("the check value", () => {
  it("accepts the right PIN and refuses a wrong one", async () => {
    const verifier = await createUnlockVerifier("482913", { userId: 17, shiftId: 412, iterations: 1_000 })
    expect(await checkUnlockPin("482913", verifier)).toBe(true)
    expect(await checkUnlockPin("482914", verifier)).toBe(false)
    expect(await checkUnlockPin("000000", verifier)).toBe(false)
  })

  it("never holds the PIN: only these fields, none of them the PIN, with a random salt each time", async () => {
    const a = await createUnlockVerifier("482913", { userId: 17, shiftId: 412, iterations: 1_000 })
    const b = await createUnlockVerifier("482913", { userId: 17, shiftId: 412, iterations: 1_000 })
    expect(Object.keys(a).sort()).toEqual(["createdAt", "hash", "iterations", "salt", "shiftId", "userId"])
    expect(JSON.stringify(a)).not.toContain("482913")
    expect(atob(a.salt)).toHaveLength(16)
    expect(atob(a.hash)).toHaveLength(32)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe("iterations", () => {
  it("aim for about 0.4 s per check, within limits", () => {
    // 37 ms per 100 000 (this development PC): about 1.08 million.
    expect(iterationsFor(37)).toBe(1_080_000)
    // A slow till, 160 ms per 100 000: 250 000, raised to the minimum.
    expect(iterationsFor(160)).toBe(MIN_ITERATIONS)
    expect(iterationsFor(5)).toBe(MAX_ITERATIONS)
  })

  it("are measured once and kept", async () => {
    await resetOfflineDbForTests()
    await deleteDB(OFFLINE_DB_NAME)
    let t = 0
    const clock = () => (t += 50) // each reading 50 ms later: 50 ms per 100 000
    const first = await calibrateIterations(clock)
    expect(first).toBe(800_000)
    expect(await getMeta("unlockIterations")).toBe(800_000)
    expect(await calibrateIterations(() => 0)).toBe(800_000)
  })
})

describe("made at an online sign-in", () => {
  it("for the shift owner, bound to the shift", async () => {
    expect(await saveUnlockVerifierAfterSignIn({ pin: "482913", cashierId: 17, tillStatus })).toBe(true)
    expect(await getUnlockVerifier()).toMatchObject({ userId: 17, shiftId: 412, iterations: 1_000 })
  })

  it("before the shift opens: no shift yet (bound when its owner opens it)", async () => {
    await saveUnlockVerifierAfterSignIn({ pin: "482913", cashierId: 17, tillStatus: { ...tillStatus, shift: null } })
    expect(await getUnlockVerifier()).toMatchObject({ userId: 17, shiftId: null })
  })

  it("not for someone signing in on another person's shift (e.g. an admin covering)", async () => {
    expect(await saveUnlockVerifierAfterSignIn({ pin: "482913", cashierId: 1, tillStatus })).toBe(false)
    expect(await getUnlockVerifier()).toBeNull()
  })

  it("not with offline off, nor on an unregistered till", async () => {
    await saveUnlockVerifierAfterSignIn({ pin: "482913", cashierId: 17, tillStatus: { ...tillStatus, offlineEnabled: false } })
    await saveUnlockVerifierAfterSignIn({ pin: "482913", cashierId: 17, tillStatus: { ...tillStatus, registered: false } })
    expect(await getUnlockVerifier()).toBeNull()
  })

  it("uses the saved till-status when the sign-in screen had none", async () => {
    await setMeta("tillStatus", tillStatus)
    await saveUnlockVerifierAfterSignIn({ pin: "482913", cashierId: 17, tillStatus: null })
    expect(await getUnlockVerifier()).toMatchObject({ shiftId: 412 })
  })
})
