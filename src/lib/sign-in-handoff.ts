// The email the invite page hands to the password sign-in after accepting (T0-6b). Kept in memory only: never in
// the URL (it would reach the frontend host's logs) or in storage. It survives a client-side move to /login; a
// reload loses it, and the sign-in field is simply empty then.

let pendingEmail: string | null = null

export function handOffSignInEmail(email: string | null): void {
  pendingEmail = email && email.trim() ? email.trim() : null
}

// Read without clearing: React may call a useState initialiser twice in development.
export function peekSignInEmail(): string | null {
  return pendingEmail
}

export function clearSignInEmail(): void {
  pendingEmail = null
}
