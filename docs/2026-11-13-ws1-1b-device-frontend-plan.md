# WS1-1b frontend plan: POS till registration

Branch: `feature/ws1-1b-device-frontend`, from `main` at `78cdd1b` (Phase 2 merged in PR #4: 429 handling and
countdowns, staff unlock, 6-digit PINs). Built against the backend contract
`docs/2026-11-13-device-registration-api-contract.md` (POS_BE). Approved 2026-11-13.

## Agreed with the backend

- **Credentials on every API request except `/public/**`.** The public order board runs on display screens, not
  tills. The backend's prompt now says "every request except `/public/**`", and `/public/**` accepts requests
  with or without credentials, so the board keeps sending none.
- **Server sign-out (contract 7.1, `POST /auth/logout`).** Public, no body, always 204, safe to repeat. It deletes
  this browser's `refreshToken` cookie and never touches `deviceToken`, so the till stays registered. The browser
  doesn't send the refresh cookie to it, so the server can't revoke that token; it only removes it from this
  browser. Every sign-out calls it (step 9): the local session is cleared first, then the request is sent without
  waiting and is never retried. A session that ends on its own (refresh refused, or a 401 after refreshing)
  calls it too.
- **`/auth/refresh` without a cookie now returns 401** (it used to return 400). Any 401 from refresh means signed
  out. Nothing relied on the old 400: every failed refresh other than 429 already ended the session.
- **`returnTo` allowlist:** `/devices` and `/devices/register` only.
- **No "This till: {name}" indicator.** There is no public, pre-sign-in way to read the till's name; it is on the
  backend backlog.

## Sign-out (findings and result)

- Every sign-out uses `logout()`: the back-office user menu; the kitchen, bar and stock-movement headers and
  their wrong-role sign-outs; the POS "Till in use" and close-out buttons; and "Sign out and return to the
  POS". There are no idle or after-sale sign-outs.
- `logout()` marks this tab as signed out (`sessionStorage`), clears the in-memory token, removes the saved
  session from `localStorage`, then calls `POST /auth/logout`. No code touches API cookies; the only
  `document.cookie` use is the sidebar's open/closed setting.
- The app never calls `/auth/refresh` on start-up. It only refreshes after an empty 401 while it holds a token,
  so after sign-out it never refreshes.
- **Remaining risk:** only if the `/auth/logout` call itself fails (offline, 429). The refresh cookie then stays
  in that browser until it is replaced by the next sign-in or expires.

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
| 9 | Server sign-out always on | The switch removed: every sign-out calls `POST /auth/logout`; a session that ends on its own (refresh 401 or other failure, or a 401 after refreshing) does too; tests for every sign-out path and for the POS working as a registered till after sign-out |

## Not covered

- "This till: {name}" indicator (backend backlog).
- Tying sessions to a till (WS1-1c).
