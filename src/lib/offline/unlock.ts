// O3 (D13): offline unlock. At a successful online PIN sign-in on a registered till with offline on, a check value
// is derived from the PIN with WebCrypto PBKDF2-SHA256 (random 16-byte salt, 256 bits) and kept for that cashier.
// Made before the shift opens, it has shiftId null and is bound to the shift its owner opens (offline context).
// The PIN itself is never stored, logged or sent; the check value never leaves the till.
// Risk: a 6-digit PIN's check value can be brute-forced by anyone who can read the till's storage. Its limits are
// its lifetime (one shift; deleted with the grant) and, in O4, flagging sales made after an offline unlock.

import { getMeta, setMeta, type UnlockVerifier } from "@/lib/offline/db"
import { putUnlockVerifier } from "@/lib/offline/db"
import type { TillStatus } from "@/lib/till"

export const UNLOCK_TARGET_MS = 400
export const MIN_ITERATIONS = 300_000
export const MAX_ITERATIONS = 3_000_000
const CALIBRATION_ITERATIONS = 100_000
export const MAX_UNLOCK_FAILURES = 5

const encoder = new TextEncoder()

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

export function webCryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle?.deriveBits === "function"
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, ["deriveBits"])
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256)
  return new Uint8Array(bits)
}

// Iterations for one check to take about UNLOCK_TARGET_MS, from the time 100 000 iterations took on this till.
export function iterationsFor(msPer100k: number): number {
  if (!(msPer100k > 0)) return MAX_ITERATIONS
  const scaled = Math.round(((UNLOCK_TARGET_MS / msPer100k) * CALIBRATION_ITERATIONS) / 10_000) * 10_000
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, scaled))
}

// Measured once per till, then kept (meta.unlockIterations).
export async function calibrateIterations(now: () => number = () => performance.now()): Promise<number> {
  const stored = await getMeta("unlockIterations")
  if (typeof stored === "number" && stored > 0) return stored
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const started = now()
  await derive("000000", salt, CALIBRATION_ITERATIONS)
  const iterations = iterationsFor(now() - started)
  await setMeta("unlockIterations", iterations)
  return iterations
}

export async function createUnlockVerifier(
  pin: string,
  { userId, shiftId, iterations }: { userId: number; shiftId: number | null; iterations: number },
  createdAt: string = new Date().toISOString(),
): Promise<UnlockVerifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt, iterations)
  return { userId, shiftId, salt: toBase64(salt), iterations, hash: toBase64(hash), createdAt }
}

// Constant-time comparison of the derived value.
export async function checkUnlockPin(pin: string, verifier: UnlockVerifier): Promise<boolean> {
  const expected = fromBase64(verifier.hash)
  const actual = await derive(pin, fromBase64(verifier.salt), verifier.iterations)
  if (actual.length !== expected.length) return false
  let difference = 0
  for (let i = 0; i < actual.length; i += 1) difference |= actual[i] ^ expected[i]
  return difference === 0
}

// After a successful ONLINE PIN sign-in. Never throws and never delays the sign-in.
// Only on a registered till with offline on, and not for someone signing in on another person's shift.
export async function saveUnlockVerifierAfterSignIn({
  pin,
  cashierId,
  tillStatus,
}: {
  pin: string
  cashierId: number
  tillStatus: TillStatus | null
}): Promise<boolean> {
  try {
    const status = tillStatus ?? (await getMeta("tillStatus"))
    if (!status?.offlineEnabled || !status.registered || !webCryptoAvailable()) return false
    const shift = status.shift
    if (shift && shift.ownerId !== cashierId) return false
    const iterations = await calibrateIterations()
    const verifier = await createUnlockVerifier(pin, { userId: cashierId, shiftId: shift?.shiftId ?? null, iterations })
    return await putUnlockVerifier(verifier)
  } catch {
    return false
  }
}

export async function unlockFailures(): Promise<number> {
  const stored = await getMeta("unlockFailures")
  return typeof stored === "number" ? stored : 0
}

// Returns the number of wrong tries so far.
export async function recordUnlockFailure(): Promise<number> {
  const next = (await unlockFailures()) + 1
  await setMeta("unlockFailures", next)
  return next
}
