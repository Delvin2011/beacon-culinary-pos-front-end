# WS1-1 Phase 2 frontend plan: login protection

Branch: `feature/ws1-1-phase2-frontend`. Built against the backend contract
`docs/2026-11-11-login-protection-api-contract.md` (POS_BE, branch `feature/ws1-1-phase2-enforcement`).
Approved 2026-11-11. Checked on 2026-11-13 against the full contract and the backend change report
(POS_BE commits `8ed1321` to `4a7a0a7`): every item in the contract's frontend checklist is covered, and
no-self-unlock was added as commit 8.

## Decisions agreed with the backend owner

- **Manager-PIN 401.** A wrong PIN on `/admin/authorize` or `/admin/authorize-session` returns
  `{"error":"Invalid PIN."}` with no `code`. An empty 401 body means the cashier's access token expired.
  `authFetch` skips refresh-and-resend when a 401 has a JSON body with `error` (or `code`), and refreshes
  on an empty 401 as before. Resending a wrong PIN counted as a second failed attempt.
- **Change password.** No screen in this task. The shared 429 handling is ready for one. A wrong old
  password returns 401 with an empty body, exactly like an expired token, so a future form must make sure
  the token is fresh before submitting and must never refresh and resend on a 401.
- **Tests.** Vitest, Testing Library and jsdom added as dev dependencies; `npm test` runs them.
- **Bar and kitchen tile logins** follow the same rules as the POS till: 6-digit PINs, a countdown per
  tile, and a block for one person never disables the other tiles.
- **Countdowns live in memory only.** After a reload the next attempt gets a fresh 429 with the correct
  remaining time; a refused attempt is not counted as a failure.
- **No self-unlock.** The backend refuses an admin unlocking their own row (409 `SELF_UNLOCK`), and an
  admin resetting their own PIN or password keeps their lock. The staff page hides Unlock on the signed-in
  admin's own row (matched by email after password sign-in, or cashier ID after PIN sign-in), shows a plain
  message if the 409 ever arrives, and says the lock stays after resetting your own credential.

## Defaults

1. A missing or unknown 429 `code` is treated as `RATE_LIMITED`.
2. A block with no time shows its message but disables nothing (a refused attempt costs nothing, and an
   admin unlock would otherwise leave the control disabled until a reload).
3. `Retry-After` is read as whole seconds only; an HTTP date is ignored.
4. Unexpected errors on the PIN screens show "Couldn't sign in. Try again." A 401 still shows
   "Incorrect PIN." for both wrong PINs and unknown people.
5. Unlock always unlocks every scope (no body); there is no per-scope choice.

## Messages

Chosen from `code` and the wait only, never from the response's `message`:

| Case | Message |
|---|---|
| `RATE_LIMITED` with a time | Too many attempts. Try again in {wait}. |
| `RATE_LIMITED` without a time | Too many attempts. Try again shortly. |
| `ACCOUNT_LOCKED` with a time | This account is temporarily locked. Try again in {wait} or ask a manager. |
| `ACCOUNT_LOCKED` without a time | This account is locked. Ask a manager to unlock it. |

`{wait}` is `m:ss`, or `h:mm:ss` from one hour up. The countdown never resends anything; at zero the
control re-enables.

## Commits

| # | Commit | Scope |
|---|---|---|
| 1 | Test tooling and this plan | `package.json`, `vitest.config.mts`, `vitest.setup.ts` |
| 2 | 6-digit PINs (can ship before the backend) | POS/bar/kitchen login, manager-PIN overlay and both callers |
| 3 | Shared 429 handling | `src/lib/login-protection.ts`, `src/hooks/use-login-blocks.ts` |
| 4 | Auth context | 401-with-error skips refresh; refresh 429 keeps the session and passes the 429 to the caller; `login`/`pinLogin` throw `LoginBlockedError`; password forms clear the password and count down |
| 5 | PIN sign-in countdowns | per tile on POS, bar and kitchen |
| 6 | Manager-PIN countdowns | one block per signed-in user, shared by the session overlay and the variance overlay; Back always works; PIN cleared after every failure |
| 7 | Staff locks and unlock | `locks` on `StaffMember`, Locked badge, admin-only Unlock with confirmation, toast after reset |
| 8 | No self-unlock | Unlock hidden on your own row; 409 `SELF_UNLOCK` shown plainly; toast when your own reset keeps your lock |
| 9 | Unlock short-term blocks | Unlock on every active row except your own, so an admin can end a cashier's 15-minute PIN block at a till; the backend's thresholds stay as they are |
| 10 | Show who needs unlocking | Reads the staff record's new `blocks` (contract 2.8): red badge per active lock or block ("PIN blocked at a till until 12:41"), red row tint, Unlock only on those rows (never your own); the confirmation lists what it clears. Falls back to step 9 when the backend doesn't send `blocks` |

## Not covered

- No change-password screen.
