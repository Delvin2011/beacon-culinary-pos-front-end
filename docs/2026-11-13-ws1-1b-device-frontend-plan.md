# WS1-1b frontend plan: POS till registration

Branch: `feature/ws1-1b-device-frontend`, from `main` at `78cdd1b` (Phase 2 merged in PR #4: 429 handling and
countdowns, staff unlock, 6-digit PINs). Built against the backend contract
`docs/2026-11-13-device-registration-api-contract.md` (POS_BE). Approved 2026-11-13.

## Agreed with the backend

- **Credentials on every API request except `/public/**`.** The public order board runs on display screens, not
  tills, and its endpoints may not allow credentialed CORS. The backend is correcting the contract (section 2 and
  checklist 9) from "every request" to "every request except `/public/**`".
- **Server sign-out.** The backend is adding `POST /auth/logout` (public, 204): it clears the `refreshToken`
  cookie with its exact path and attributes and never touches `deviceToken`. The frontend calls it from
  `logout()` when `NEXT_PUBLIC_AUTH_LOGOUT_ENABLED=true`, after clearing the local session; the result is
  ignored and never retried. Until the endpoint exists, sign-out stays local.
- **`returnTo` allowlist:** `/devices` and `/devices/register` only.
- **No "This till: {name}" indicator.** There is no public, pre-sign-in way to read the till's name; it is on the
  backend backlog.

## Sign-out today (findings)

- `logout()` works only in the browser: it marks this tab as signed out (`sessionStorage`), clears the in-memory
  token and removes the saved session from `localStorage`. No backend call.
- The app never calls `/auth/refresh` on start-up. It only refreshes after an empty 401 while it holds a token,
  so after sign-out it never refreshes.
- **Remaining risk until `POST /auth/logout` is switched on:** the admin's `refreshToken` cookie stays valid
  after sign-out. Someone at that till could get a fresh admin access token by calling `/auth/refresh` from the
  browser's developer tools. This lasts until a cashier signs in on that till (which replaces the cookie) or the
  cookie's 7 days pass.

## Re-sign-in and return

- `/login?reauth=1&returnTo=<path>` shows the password form even when someone is signed in, explains "Sign in
  again with your password to manage tills.", and replaces the current session on success.
- `returnTo` must be an internal path on the allowlist: it starts with exactly one `/`, is not `//…` or `/\…`,
  has no scheme and no control characters. Anything else is ignored and the user goes to their default page.
- After sign-in, an ADMIN returns to `returnTo`. Anyone else stays on the sign-in page with "Only managers can
  register tills." and never reaches the device pages.
- Only the register form's fields (name, serial number, asset tag) are kept in `sessionStorage` during the round
  trip; they are restored on return and then deleted. The password is never stored.
- A wrong password during re-sign-in ends the current session (existing `login()` behaviour, kept).

## Rules

- Branch on the error `code` only, never on message text. Device errors are `{error, code, details?}`: show
  `error`. 429s stay `{code, message, retryAfterSeconds}` and keep the Phase 2 countdowns.
- `DEVICE_NOT_REGISTERED` is never treated as a sign-out and never retried automatically; a manual "Try again"
  is fine.

## Commits

| # | Commit | Scope |
|---|---|---|
| 1 | Plan doc | This document |
| 2 | Credentials | `credentials: "include"` on the cashier, bar and kitchen list requests; the public board unchanged; a test for each way the app sends requests |
| 3 | Shared device code | `src/lib/api-error.ts`, `src/lib/devices.ts`, `src/lib/return-to.ts`, with tests |
| 4 | Re-sign-in and return | `/login?reauth=1&returnTo=…`; non-admin message; register draft in `sessionStorage` |
| 5 | Server sign-out | `logout()` calls `POST /auth/logout` when `NEXT_PUBLIC_AUTH_LOGOUT_ENABLED=true`; local sign-out first |
| 6 | `DEVICE_NOT_REGISTERED` handling | POS cashier list, PIN pad and both approval dialogs; bar and kitchen stale admin tiles; shift-close sign-out on HTTP 401 instead of message text |
| 7 | Register this till | `/devices/register`: config-driven form, cookie check after 201, every error code, "Sign out and return to the POS" |
| 8 | Registered tills | `/devices`: list, edit, rename, revoke one browser or the whole till, warnings, empty state, sidebar entry |

## Not covered

- "This till: {name}" indicator (backend backlog).
- Tying sessions to a till (WS1-1c).
