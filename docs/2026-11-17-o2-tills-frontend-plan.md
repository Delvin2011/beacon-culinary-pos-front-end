# O2 frontend plan: tills, per-till shifts, sessions and lock screen

**Branch:** `feature/o2-tills-frontend`, from `feature/o1-resilience-frontend` at `fd8ef3e`. O1 wasn't merged into
`main` when O2 started, and O2 depends on it: a sale whose outcome is unknown is resent with the same `clientOrderId`,
and the till can't lock while a sale is pending.

**Contract:** `docs/2026-11-17-o2-tills-shifts-api-contract.md` (POS_BE, backend commit `537450e`).

**Approved:** 2026-11-17. Every test mocks `fetch` to the contract, because the backend isn't deployed.

## Decisions (agreed with the backend)

1. **The owner's tile:** `shift.ownerId` is the user's id, the same as `id` in `GET /users/cashiers`.
2. **A manager on a locked till:**
   - A PIN tile (ADMINs are on the POS tiles) or a password sign-in both work, and the screen says "or a manager".
   - Force close, late count and confirm-no-count still need a password sign-in within 30 minutes. A manager who signed in by PIN goes through the existing password re-sign-in.
3. **Expected cash for force close** comes from `GET /admin/shifts/{id}/activity` (`expectedCashBreakdown`).
4. **A manager and another cashier's pending sale:** the till offers "Manager: finish this sale" behind a confirm step, and sends the stored body and `clientOrderId` unchanged.
   - If the sale reached the server, it comes back as a replay.
   - If it didn't, it is recorded with the manager as the cashier.
5. **"—" for an empty amount** is fine. The only rule is "never 0.00 for a shift that wasn't counted".
6. **The not-registered message** stays the existing text: "This till is not registered. Ask a manager to register it."
7. **Lock till and auto-lock:**
   - The **Lock till** button is on `/pos` only.
   - **Auto-lock** covers every POS screen with a signed-in session, including `/pos/shift-open`.
8. **Logout** sends the bearer token and is awaited for at most 2 s, without `keepalive`. Browsers may refuse a keepalive request that needs a CORS preflight.
9. **A failed `POST /pos/lock`** (no answer or 5xx):
   - The till is still locked here.
   - The token is kept in memory only and sent once more, either on the browser's `online` event or when the sign-in screen next reaches the server.
   - Until then, the till status shows "In use by {owner}".
10. **The force-close draft** is kept in sessionStorage across the re-sign-in. It holds the shift id, owner name, till label, count, "can't count", reason and variance reason. It never holds a password or token, and is cleared on submit or cancel.

## What the till does now

### Sessions (step 1)

- **Session ended:** a 401 `SESSION_ENDED`, from refresh or from any response, ends the session with no refresh.
  - The cart is kept, the tokens are dropped and the sign-in screen shows the message for `details.reason`. That covers all seven reasons, `IDLE` included even if the screen was in use.
  - An empty 401 and `AUTHORIZATION_INVALID` keep their old handling.
- **Lock till (`lockTill()`):** keeps the cart, sends `POST /pos/lock` with the bearer token (5 s limit) and drops the tokens. The shift stays open.
- **Sign-in refusals:** PIN and password sign-in throw `TillLockedError` and `ShiftOpenOnOtherTillError`, built from the error `code` and `details`. They never use the server's text.

### Sign-in screen (step 2)

- **When `GET /pos/till-status` is read:** on load (which covers arriving after a lock or sign-out) and after any refused sign-in.
- **Till line:** "T1 · Till 1 (front)" on a registered till. An unregistered browser gets no till line; with `requireRegistered` on, it gets the not-registered screen and no POS sign-in.
- **Shift line:**
  - locked: "T1 is locked. Shift of Thandi Mokoena since 07:58.";
  - in use: "In use by Thandi Mokoena.";
  - then "Only Thandi Mokoena or a manager can sign in."
- **The owner's tile** is highlighted, with "Shift open · tap to resume" or "Signed in".
- **Messages:**
  - `TILL_LOCKED`: "In use by {owner} ({till}). Only they or a manager can sign in."
  - `SHIFT_OPEN_ON_OTHER_TILL`: "You have an open shift on {till code, or Unregistered till}. Close it there first, or ask a manager."

### POS header, lock and cart (steps 4 and 5)

- **Header:** "{tillCode} · {cashier}", or "Unregistered till · {cashier}".
- **Lock till** keeps the shift open and goes to sign-in. **End shift** is the existing close and cash-up.
- **When they're disabled:** both wait while any of these is open (`lib/lock-guard`):
  - a payment;
  - a sale being sent or not yet confirmed;
  - the manager-PIN dialog;
  - the cash-up.
- **The kept cart:** a lock or a server-ended session saves the cart in `pos.pendingCart` (localStorage), tagged with its owner.
  - The same person signing in gets it back.
  - Anyone else is asked "Keep it for {owner}" or "Discard it".
- **Auto-lock:**
  - After `idleLockMinutes` without pointer, touch or key input, a 30 s warning appears with **Stay signed in**. Then it does what Lock till does.
  - It is postponed while the lock guard is busy, and counts again from when the screen is free.

### Shifts, sales and refunds (step 6)

- **Shift open:**
  - `SHIFT_OPEN_ON_OTHER_TILL` names the other till.
  - `SHIFT_ALREADY_OPEN` loads this till's shift and moves on to `/pos`.
  - `DEVICE_NOT_REGISTERED` shows the existing message.
  - The old match on "already open" text is gone.
- **Sales, complimentary orders, voids and refunds:** `DEVICE_NOT_REGISTERED` shows the existing message. On a void or refund, `TILL_IN_USE` reloads the shift and says only the owner or a manager can do it.
- **A sale whose outcome was unknown** when the session ended is resent with the same `clientOrderId` after the same person signs in again (O1's resume).

### Manager screens (steps 7 and 8)

- **POS Activity, Tills view** (`GET /admin/tills`):
  - each till shows its code and name, owner, opened time, and Locked, In use or No shift;
  - the Unregistered till appears only while it has a shift;
  - a row with a shift offers Force close and Activity; a registered till also links to its Device page;
  - it replaces "On the till now", which read `/shifts/open`, now the shift of the admin's own browser.
- **Force close:**
  - expected cash;
  - a required reason;
  - counted cash, or "Drawer can't be counted now";
  - a variance reason when the count differs, plus the 400 field error;
  - a confirm step;
  - `REAUTH_REQUIRED` keeps the draft and comes back to the form;
  - `SHIFT_ALREADY_CLOSED` says so and reloads the lists.
- **Uncounted shifts:**
  - The shift dialog offers **Record count** (handling `SHIFT_NOT_UNCOUNTED`, `ALREADY_SIGNED_OFF`, `DAY_CLOSED` and `REAUTH_REQUIRED`) and **Confirm no count** (a sign-off with `confirmNoCount: true` and a required note).
  - The shift list shows Till, Cash count and Force-closed.
  - A sign-off refused with `SHIFT_UNCOUNTED` in the reports links to `/pos-activity?shiftId=…`.
- **Device pages:**
  - "T1 · name" with an editable till code (upper-cased, 1–10 of A–Z, 0–9 and "-"; a blank code is left unchanged);
  - `TILL_CODE_IN_USE` and the `tillCode` field error;
  - `TILL_LIMIT_REACHED`: "The maximum number of tills (3) is registered. Revoke one first.", with the form kept;
  - the revoke text says everyone on the till is signed out;
  - the settings show the most active tills and whether selling needs a registered till.

### Reports (step 9)

- **The report viewer is generic and needs no change.** Tests prove it renders:
  - Z version 1, and version 2 with the Till column and the Tills section (slip columns included);
  - the Cash-up's till column with a "Not counted" row;
  - the Cashier reading's Till and Cash count lines.
- **Blanks:** null counted cash and variance show "—", never 0.00. The POS close-out shows the till and uses the same blank.

## Tests

The suite has 372 tests, all passing; `tsc` and lint are clean. The O2 tests:

| File | Covers |
|---|---|
| `contexts/auth-context.session-ended.test.tsx` | each `SESSION_ENDED` reason (write and refresh); not for `AUTHORIZATION_INVALID` or an empty 401; Lock till, offline retry; `TILL_LOCKED` and `SHIFT_OPEN_ON_OTHER_TILL` at sign-in |
| `contexts/auth-context.logout.test.tsx` | logout sends the bearer token, no keepalive, finishes within 2 s |
| `app/pos/login/till-status.test.tsx` | unregistered (`requireRegistered` on and off), no shift, in use, locked; owner resume; `TILL_LOCKED` for others; a manager on a locked till; `SHIFT_OPEN_ON_OTHER_TILL`; the session-ended notice; password `TILL_LOCKED` |
| `app/pos/lock-till.test.tsx` | header; Lock till keeps cart and shift; disabled during a payment and a pending sale; cart restored only for the same user; Keep and Discard; the cart is kept on `SESSION_ENDED` |
| `components/pos/auto-lock.test.tsx` | timing, input resets, Stay signed in, postponed during a payment and a pending sale, a dialog cancels the warning |
| `app/pos/shift-open/shift-open-errors.test.tsx` | `SHIFT_OPEN_ON_OTHER_TILL`, `SHIFT_ALREADY_OPEN`, `DEVICE_NOT_REGISTERED` at shift open |
| `components/pos/order-builder.pending-sale.test.tsx` | a sale resent with the same id after `SESSION_ENDED` and a new sign-in; a manager finishing another cashier's sale; a cashier can't |
| `components/pos/order-builder.adjustment-idempotency.test.tsx` | `TILL_IN_USE` on a void |
| `components/pos-activity/tills-view.test.tsx` | locked, in use, no shift, the unregistered row |
| `components/pos-activity/force-close-dialog.test.tsx` | counted, uncounted, with a variance, the field error, re-authentication with the draft, `SHIFT_ALREADY_CLOSED` |
| `components/pos-activity/cash-count-dialog.test.tsx` | late count, its refusals and re-authentication; confirm no count |
| `components/reports/report-actions.test.tsx` | a `SHIFT_UNCOUNTED` sign-off links to the shift |
| `app/pos-activity/page.test.tsx` | Till and Cash count columns; uncounted values are blank |
| `app/devices/page.test.tsx`, `app/devices/register/page.test.tsx`, `lib/devices.test.ts` | till code display and edit, `TILL_CODE_IN_USE`, the field error, `TILL_LIMIT_REACHED`, the revoke text |
| `components/reports/report-statement.o2.test.tsx` | Z version 1 and 2, the Tills section and slip, the Cash-up "Not counted" row, the Cashier reading, `moneyOrDash` |

## Risks and open points

- **One kept cart at a time.** If a second person's cart is kept while another person's is still stored, the newer one replaces it.
- **Restored cart lines keep their saved prices.** Stock, availability and price are checked by the server when the sale is confirmed, as for any cart.
- **Auto-lock on `/pos/shift-open`** has nothing to keep (no shift, no cart). It ends the session as Lock till does.
- **A lock that never reaches the server** leaves the session active there until the owner signs in again (replacing it) or it idles out after 30 minutes. The till status shows "In use" meanwhile. Others are still refused by the sign-in rules.
- **Deploy:** everyone signs in once more after the backend deploy and sees "Your session has expired. Please sign in again." (contract 3).
- **Back-office pages** still show the server's error text for codes O2 doesn't add. The new codes are all branched on.

## Commits

1. `6474f4b` sessions, lock and till sign-in refusals
2. `b36f2a8` till status on the POS sign-in screen (the password sign-in needed no code change; its test is here)
3. `ea0efc9` POS header, Lock till and the kept cart
4. `25292bd` auto-lock
5. `ee489ee` shift open, sales and refunds per till
6. `57408fd` Tills view, force close and uncounted shifts
7. `9a8ec48` till codes on the device pages
8. `d6a1273` reports and close-out without 0.00 for uncounted cash
9. this document
