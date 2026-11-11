// Login protection (WS1-1 Phase 2): reading the backend's 429 "too many attempts" response and wording it.
//
// A 429 can come from /auth/** (login, pin-login, refresh, me), /admin/authorize, /admin/authorize-session
// and /users/{id}/change-password. Its body is { code, message, retryAfterSeconds }, and Retry-After (seconds)
// is set whenever there is a time. Messages are chosen from the code and the wait only, never from the body's
// `message` or anything else that could differ between a real and an unknown account.

export type LoginBlockCode = "RATE_LIMITED" | "ACCOUNT_LOCKED"

export interface LoginBlock {
  code: LoginBlockCode
  // Seconds until the user may try again; null when there is no time (a manager must unlock the account).
  retryAfterSeconds: number | null
}

function asWait(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null
}

function headerWait(res: Response): number | null {
  const raw = res.headers.get("Retry-After")?.trim()
  // Whole seconds only; an HTTP date isn't used by this backend.
  return raw && /^\d+$/.test(raw) ? Number(raw) : null
}

// Null unless the response is a 429. A missing, malformed or unknown body is treated as RATE_LIMITED.
// Reads a clone, so the caller can still read the body.
export async function readLoginBlock(res: Response): Promise<LoginBlock | null> {
  if (res.status !== 429) return null

  let body: Record<string, unknown> | null = null
  try {
    const parsed = (await res.clone().json()) as unknown
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>
  } catch {
    body = null
  }

  return {
    code: body?.code === "ACCOUNT_LOCKED" ? "ACCOUNT_LOCKED" : "RATE_LIMITED",
    retryAfterSeconds: asWait(body?.retryAfterSeconds) ?? headerWait(res),
  }
}

// m:ss below an hour, h:mm:ss from an hour up.
export function formatWait(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = String(total % 60).padStart(2, "0")
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`
}

export function loginBlockMessage(code: LoginBlockCode, remainingSeconds: number | null): string {
  const hasTime = remainingSeconds !== null && remainingSeconds > 0
  if (code === "ACCOUNT_LOCKED") {
    return hasTime
      ? `This account is temporarily locked. Try again in ${formatWait(remainingSeconds)} or ask a manager.`
      : "This account is locked. Ask a manager to unlock it."
  }
  return hasTime ? `Too many attempts. Try again in ${formatWait(remainingSeconds)}.` : "Too many attempts. Try again shortly."
}
