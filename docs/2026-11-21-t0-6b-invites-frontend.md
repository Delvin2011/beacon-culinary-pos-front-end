# T0-6b invite page and staff invite actions: frontend

Builds on T0-6a (backend branch `feature/infrastructureUpdatesBE`, V116). Contract:
[2026-11-21-t0-6-invites-api-contract.md](2026-11-21-t0-6-invites-api-contract.md). The runbook
(`docs/2026-11-21-first-admin-and-invites.md`) lives in the backend repository. The API is mocked to the contract
in every test here; nothing has run against the real backend yet (see "Before merging").

## What staff see

### The invite page: `/invite#t=<token>`

1. The page reads `t` from the hash, keeps it in memory, and clears the hash before anything is sent.
2. It looks the link up and shows "Welcome, {userName}. Set up your {roleLabel} sign-in.", the expiry in local time,
   and the fields the link sets: password and/or PIN, each REQUIRED, OPTIONAL (may be left empty) or NONE (hidden),
   each entered twice. Password 6–25 characters; PIN exactly 6 digits.
3. Saving accepts the link. It never signs anyone in: "You're all set. Sign in with your new details." and one button:

| `signInWith` | Role | Button goes to |
|---|---|---|
| `PASSWORD` | any | `/login`, with the email filled in |
| `PIN` | CASHIER | `/pos/login` (works only on a registered till) |
| `PIN` | KITCHEN | `/kitchen/login` |
| `PIN` | BARISTA | `/bar/login` |
| `PIN` | other | `/pos/login` |

| Case | Shown |
|---|---|
| No token (e.g. the page was refreshed after the hash was cleared) | "This link can only be opened once from the original message. Open the link again, or ask a manager for a new one." No call is made |
| A token that can't be one (cut short when pasted) | "This link isn't valid. Ask a manager for a new one." No call is made |
| `INVITE_INVALID` | "This link isn't valid. Ask a manager for a new one." |
| `INVITE_EXPIRED` | "This link has expired. Ask a manager for a new one." |
| `INVITE_USED` | "This link has already been used.", a Sign in button to `/login`, and "If you sign in with a PIN, use the till, kitchen or bar screen." (the 410 says nothing about how the person signs in) |
| `INVITE_CREDENTIALS_INVALID` | `details.fields` under each field; the link still works |
| `PIN_IN_USE` | "Choose a different PIN." under the PIN |
| 429 | "Too many attempts. Try again in m:ss." with `Retry-After` (or the body's `retryAfterSeconds`), otherwise "Try again in a few minutes." On lookup, a Try again button reuses the token in memory |
| Other codes or none | The server's text as it is |

The wording follows the T0-6b prompt ("Ask **a** manager"); the contract's table says "Ask **your** manager".

### Staff screen (ADMIN only)

- Under each person's sign-in badges: "Link sent, expires {expiresAt}" (PENDING), "Link expired", "Link revoked";
  nothing for NONE and USED.
- **Sign-in link** (active people, not your own row) opens a dialog: "Send set-up link" (STAFF_SETUP, the default when
  none of the role's credentials is set) or "Reset sign-in by link" (RESET). For a reset where the role's PIN is
  optional (Head Chef), "Also reset the PIN" sends `credentials: BOTH`; otherwise `credentials` is left out.
- **Revoke link** (PENDING or EXPIRED) asks first, then refreshes the person from the response.
- **The link dialog**, shown once: the link (the API's `link`, or `{origin}/invite#t={token}` when it is null), Copy,
  a QR code, and "This link works once and expires at {expiresAt}. Send it privately to the person." Closing it
  discards the token; to share it again, send a new link.
- **Add Staff** offers "Send them a link" (`setup: INVITE`, the default: no password or PIN fields; email still
  required for roles that use a password) or "Set password/PIN now" (`setup: SET_NOW`, as before). The response's
  `issuedInvite` opens the link dialog; the list keeps the person without it.
- Errors: `INVITE_SELF` "Change your own password or PIN from your profile.", `INVITE_USER_INACTIVE` "This person is
  deactivated. Activate them first.", `INVITE_DEMO_ACCOUNT` "Demo accounts can't get a link.",
  `INVITE_REQUEST_INVALID` lists `details.fields` ("Email: …").
- `REAUTH_REQUIRED` (a link for an ADMIN, or creating an ADMIN by invite): what the admin chose is kept in
  sessionStorage under `staff.invite.pending` (staff id and purpose, or name, role and email: never a token,
  password or PIN), the admin signs in again at `/login?reauth=1&returnTo=/staff`, and back on `/staff` the dialog
  asks "Send the link to {name} now?" (or shows the create form with "Signed in again. Check the details, then
  create {name} and send the link."). Nothing is sent without that confirm: sending replaces any open link, and
  creating makes the person.

Sign-in screens are unchanged. A demo account is refused exactly like a wrong credential (401), on purpose.

## How the token is kept safe

| Rule | Where |
|---|---|
| Read from `location.hash` once (a ref guards React's double effects in development), kept in a `useRef` | `src/app/invite/page.tsx` |
| Hash removed with `history.replaceState(history.state, "", pathname + search)` before the first request; Next's history state is kept | same |
| Sent only in the bodies of `POST /auth/invites/lookup` and `/accept`, by a plain `fetch` with `credentials: "omit"` (not even the refresh cookie), `cache: "no-store"`, `referrerPolicy: "no-referrer"` and no `Authorization` | `src/lib/invites.ts` |
| `/invite` runs outside `AuthProvider` and the Toaster (like `/board`): no bearer token, no refresh-on-401, no redirects | `src/components/providers.tsx` |
| Never in an error, message, storage, cookie, console output, URL or history entry; errors are built from the code only | tests in `src/app/invite/page.test.tsx` and `src/lib/invites.test.ts` |
| The page sends no Referer and is kept out of search results | `src/app/invite/layout.tsx` metadata |
| On the staff screen the token lives only in the link dialog's state; `issuedInvite` is stripped before the person goes into the list | `src/app/staff/page.tsx`, `src/components/staff/staff-form-dialog.tsx` |
| The QR code is drawn in the browser by `qrcode.react` 4.2.0 (MIT, pinned exactly, bundled), only in the link dialog, and unmounts when it closes | `src/components/staff/invite-link-dialog.tsx` |
| The service worker never handles `/invite` or `/auth/invites/*`: an explicit exclusion checked before anything else | `src/sw/routes.mjs` |
| The email for `/login` is handed over in memory (`src/lib/sign-in-handoff.ts`), never in the URL or storage; a reload of `/login` just leaves the field empty | `src/components/login-form.tsx` |

### Third-party scripts

None on any page. The root layout uses `next/font/local` (Geist, served from this app); there is no `<Script>`,
analytics, error reporting or chat widget, and `next.config.mjs` adds none. The only external resources anywhere are
the create-next-app template images on `/` (`src/app/page.tsx`, from nextjs.org), which isn't `/invite`. A test
renders `/invite` inside the real `Providers` and checks for no script, stylesheet, iframe or external image.

### The password rule

The frontend checks 6–25 characters (`PASSWORD_MIN` / `PASSWORD_MAX` in `src/lib/staff.ts`), as the contract says.
What the backend enforces couldn't be read here (its source isn't in this repository); the dev check below confirms
it. Not changed.

## Before merging: one end-to-end check on dev

Once T0-6a is merged and deployed to dev:

1. As an admin, Add Staff → a Head Chef with "Send them a link". The link dialog shows a link and a QR code.
2. Open the link in a private window. The address bar shows `/invite` with no `#t=`.
3. Try a 5-character password, then a 26-character one: both refused (in the browser; then confirm the backend's
   own rule by bypassing the browser check, e.g. from the dev tools, and note the `details.fields` message).
4. Set a password and a PIN; "You're all set." → Sign in → `/login` with the email filled in → sign in.
5. Open the same link again: "This link has already been used."
6. On the staff screen: "Sign-in link" → Reset for that person, then Revoke link; opening the revoked link shows
   "This link isn't valid."
7. For another admin: Sign-in link → re-sign-in → "Send the link to {name} now?" → the link dialog.

## Known limits

- A cashier who finishes on their phone and taps the POS button reaches `/pos/login`, which only works on a
  registered till; the hint under the button says "Sign in at a till".
- If the browser already holds someone else's session (an admin's tablet), `/login` forwards to that person's
  landing page instead of showing the sign-in. Accepting ends only the invited person's sessions.
- Until the page's JavaScript runs, the hash is still in the address bar; removing it earlier would need an inline
  script, a second place that handles the token.
- IndexedDB isn't available in the test environment; the page doesn't use it (nor does anything it imports).

## Files

Created:
- `docs/2026-11-21-t0-6-invites-api-contract.md`, `docs/2026-11-21-t0-6b-invites-frontend.md`
- `src/lib/invites.ts`, `src/lib/invites.test.ts`, `src/lib/invites.test-fixtures.ts`
- `src/lib/sign-in-handoff.ts`, `src/lib/staff-invite-draft.ts`
- `src/app/invite/layout.tsx`, `src/app/invite/page.tsx`, `src/app/invite/page.test.tsx`
- `src/components/invite/invite-setup-form.tsx`
- `src/components/staff/send-invite-dialog.tsx`, `src/components/staff/invite-link-dialog.tsx`
- `src/app/staff/page.invites.test.tsx`, `src/app/staff/page.create-invite.test.tsx`

Modified:
- `package.json`, `package-lock.json` (`qrcode.react` 4.2.0)
- `src/components/providers.tsx`, `src/components/login-form.tsx`
- `src/sw/routes.mjs`, `src/sw/sw-routes.test.ts`
- `src/lib/staff.ts`, `src/lib/return-to.ts`, `src/lib/return-to.test.ts`
- `src/components/login-form.reauth.test.tsx` (its "not on the allowlist" example moved from `/staff` to `/inventory`)
- `src/app/staff/page.tsx`, `src/components/staff/staff-form-dialog.tsx`
