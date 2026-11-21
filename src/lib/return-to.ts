// Where /login?reauth=1&returnTo=… may send someone back to. Only internal paths on this allowlist are accepted;
// anything else (other sites, "//host", full URLs, unknown routes) is ignored so sign-in can't be used to redirect
// elsewhere.

export const RETURN_TO_ALLOWLIST = ["/devices", "/devices/register", "/pos-activity", "/site-settings", "/meal-periods", "/stock-locations"] as const

export type ReturnToPath = (typeof RETURN_TO_ALLOWLIST)[number]

// The path, or null when it isn't an allowed internal path.
export function safeReturnTo(raw: string | null | undefined): ReturnToPath | null {
  if (typeof raw !== "string") return null
  // No control characters, backslashes or schemes anywhere.
  if (/[\u0000-\u001f\u007f\\]/.test(raw) || raw.includes(":")) return null
  // Exactly one leading slash: "//host" is another site.
  if (!raw.startsWith("/") || raw.startsWith("//")) return null
  return (RETURN_TO_ALLOWLIST as readonly string[]).includes(raw) ? (raw as ReturnToPath) : null
}

// The sign-in link that brings an admin back to `returnTo` after a fresh password sign-in.
export function reauthLoginPath(returnTo: ReturnToPath): string {
  return `/login?reauth=1&returnTo=${encodeURIComponent(returnTo)}`
}
