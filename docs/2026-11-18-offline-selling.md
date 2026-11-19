# Offline selling, the outbox and sync (O4 frontend)

How the till sells while offline, keeps those sales, and hands them to the server, and how managers review what they raise. It builds on the offline foundation (`2026-11-18-offline-foundation.md`) and follows the backend contracts `2026-11-18-o4-offline-sync-api-contract.md` (O4) and `2026-11-17-o3-offline-foundation-api-contract.md` (O3). Everything is behind `offlineEnabled`: with it off, the till behaves as before.

## When the till sells offline

`offlineSellingState` (`src/lib/offline/selling-state.ts`) builds on O3's readiness. The till sells offline when it is offline (the connection indicator), O3's readiness holds, and none of these stops applies:

| Stop | When | Banner |
|---|---|---|
| Offline limit | Offline longer than `maxOfflineHours` | Offline limit reached. Reconnect to keep selling. |
| Grant expired | The grant's `expiresAt` has passed, by server time | This till's offline permission has expired. … |
| Midnight | The server-time date in Johannesburg is after the snapshot's `tradingDay` | A new trading day has started … |

From `warnOfflineHours` the banner turns amber. The banner also counts the sales waiting to send. The stops are checked again at the moment of Confirm, since the banner's state can be up to 30 s old.

While offline and allowed to sell, the order builder shows the snapshot's tiles, even over a live menu loaded before the connection dropped. Back online, the live menu returns.

## Building and recording a sale

- **Money is integer cents** (`src/lib/offline/cents.ts`). Amounts become cents by reading their digits, never by multiplying a float.
- **Line totals** follow the contract: a line's `lineTotal` excludes its extras, each extra has its own `lineTotal`, and `subtotal` = `total` = the sum (no discount offline).
- **VAT** is O2b's rule: `round(total × rate ÷ (1 + rate))`, half up, in integer maths on the snapshot's 4-decimal rate. It is tested against every example in the O2b contract.
- **Numbers:** `offlineSeq` is the larger of the till's counter and the grant's `nextOfflineSeq`, per trading day. The receipt number is `T1-YYYYMMDD-NNNN` and the collection number `T1-N`. The collection number prints large on the receipt and kitchen ticket.
- **Payments:**
  - **Cash:** tendered ≥ amount, change exactly the difference.
  - **Card:** slip reference required, at most 50 characters.
  - **Account:** when the grant and snapshot allow it, from the snapshot's accounts, no manager PIN, refused past `accountCap` for the account under this grant.
  - The online split rules apply: at most 2 payments, and ACCOUNT on its own.
- **Not available offline,** each with its reason on the button: discount, complimentary, voids and refunds (Remove Extras too), the shift reading, End shift. Signing out to change cashier is also disabled.
- **`unlockedOffline`** is true while the cashier's session is the O3 offline session, which exists from an offline unlock until the next online sign-in.

Confirm (`useOfflineCheckout().record`) checks the stops, the local portion counts and the payments, then writes the sale in **one IndexedDB transaction**. That transaction re-checks the number counter and the account cap and moves the counter on. Only after it commits does the till clear the cart, show **Offline sale recorded** and print. A refusal keeps the cart.

## The outbox

`src/lib/offline/outbox.ts`, in the O3 database (`outbox` store, keyed by `clientOrderId`). Each entry holds:

- `payload`: the contract's sale, without `tillClockAtSendUtc`;
- `grant`: the signed grant string it was made under, exactly as received. It lives exactly as long as the sale: through a newer grant, and through a revoke (`wipeAll` keeps the outbox);
- `status`: `PENDING`, `SYNCED`, `INVALID` or `REFUSED`, with the server's result or error;
- `print`: what the slips need (till name, cashier, account names);
- `wasPendingOnline`: a stuck online sale (see below);
- `handedToSupport`: an ADMIN's note, for an `INVALID` or `REFUSED` sale.

Rules:

- Nothing unsynced is ever deleted or changed, apart from its status when the server answers, or the support note. A `SYNCED` entry is deleted 7 days after its sync.
- **Portion counts and the account ledger are worked out from the outbox,** not stored separately:
  - a tile's count is the snapshot's count, minus the outbox's sales the snapshot doesn't include yet (not synced, or synced after `generatedAt`), minus the cart;
  - an account's offline total is the sum of its ACCOUNT payments under the grant.

  So they can never disagree with the sales recorded. O3's `accountLedger` store stays unused. A null count means no limit; a count never goes below 0.
- **Waiting** means not `SYNCED` and not handed to support. `INVALID` and `REFUSED` count as waiting until an ADMIN hands them to support.

## A sale stuck online (decision H)

At Confirm (offline on, no discount, not complimentary), O1's pending sale also stores an `offlineDraft`: the priced lines, the payments and the server-corrected confirm time.

When the till is offline and may sell offline, a sale stuck in "Checking the sale…" (O1 phase `sending` or `unconfirmed`) is recorded in the outbox:

- with the **same `clientOrderId`**;
- with its confirm time as `soldAt`;
- with new offline numbers;
- not refused by counts or the cap, since the money was taken (its account charge still counts against the cap later).

O1's record is cleared only after that, and the sale then prints as an offline sale. Its kitchen ticket says **Was pending online: check the kitchen screen before preparing**.

A card sale first asks for the slip reference. With **No slip**, it goes without one and the server raises `CARD_REFERENCE_MISSING`. Discounted and complimentary sales stay pending until online. If the online sale had gone through, sync gets `DUPLICATE` and the server stores the slip's numbers on it.

## Sync

`src/lib/offline/sales-sync.ts`, run by `src/components/pos/offline-sync.tsx` on every POS screen, including sign-in and lock. It uses the till cookie only.

- **Batches:** `PENDING` sales oldest first, at most 50 sales and 10 grants, and under 500 KB (the contract's limit is 512 KB). Each grant's signed string goes once. `tillClockAtSendUtc` is the till's own clock when the batch leaves.
- **Per sale:**
  - `CREATED`, `CREATED_WITH_EXCEPTIONS` and `DUPLICATE` are marked `SYNCED`, with the order id, numbers and exceptions;
  - `INVALID` and `REFUSED` are kept with the error and never resent;
  - an answer outside the contract leaves the sale `PENDING`.
- **Whole batch:**

  | Answer | What the till does |
  |---|---|
  | 5xx, network failure, timeout | Waits (5 s, 15 s, 30 s, 1 min, 2 min, then 5 min) and resends the same sales |
  | 403 `DEVICE_NOT_REGISTERED` | Stops, with an alert to register the till again. Resumes after registration (or when till-status says registered) |
  | 400 `INVALID_BATCH`, 413, 415 | Stops, with an alert to call support and **Try again**. A new app version also resumes it |

- **After each batch,** the heartbeat sends a status report straight away with the waiting counts (per shift and trading day), `oldestPendingSoldAt` and `lastSyncAt`, so `OFFLINE_SALES_PENDING` clears at 0. The regular 60-second report carries the same counts.

## On the till and in the back office

- **End shift** is disabled while this shift has sales waiting ("3 offline sales still to send"). The server's 409 `OFFLINE_SALES_PENDING` is still handled, and managers can force-close in POS Activity.
- **Today's Orders offline** lists this till's offline sales of the day: **Offline, not yet sent**, **Sent** or **Needs support**.
- **Registered tills** lists `INVALID` and `REFUSED` sales with the server's error, **Copy details for support** (no grant string), and, for an ADMIN, **Handed to support** with a required reason.
- **Sale exceptions** (`/sale-exceptions`, ADMIN), with a count in the sidebar:
  - the list opens on open REVIEW exceptions, filters by status, severity, type, day and till, and pages up to 200;
  - the detail shows the full order;
  - **Resolve** needs a note; **Approve account charge** is the only way to close `ACCOUNT_APPROVAL_PENDING`;
  - errors are read by code.
- **The Tills view** shows each till's open exceptions, linked to that till's list.
- **Order views** (Today's Orders online, the receipt reprint) mark offline sales: **Offline sale**, the collection number, the sale time and **Booked to {day}**.
- **The X and Z** offline section and the `offline-exceptions` check need no code: the statement viewer renders them generically (tested).

## Tests

- **Vitest:** 805 tests in 104 files, all passing. O4's unit and component tests sit next to their files.
- **Playwright** (`npm run test:e2e`): `e2e/offline-reload.spec.ts` (O3) and `e2e/offline-selling.spec.ts` (O4). The O4 test goes offline mid-shift and:
  1. sells cash, card and account sales;
  2. reloads;
  3. locks and unlocks with the PIN;
  4. sells again;
  5. reconnects;

  then checks the batch, its grant, `unlockedOffline`, the outbox emptied, a 0-waiting status report and the sales shown as offline sales.

## Limits and notes

- **The portion counts compare** the time a sale was synced with the snapshot's `generatedAt`. A large difference between the till's clock and the server's can be off by a sale for a moment. The server records any oversell as `OVERSOLD`.
- **"Handed to support" is used on the devices page,** where the POS status report doesn't run. The server's waiting count corrects itself with the till's next status report from a POS screen.
- **A sale under an 11th grant** waits for the next batch, so a batch can skip it while staying in `soldAt` order.
- **Without persistent storage,** the browser may evict the outbox under storage pressure. The devices page shows whether storage is persistent (O3).
- **After a reload while offline,** the connection indicator starts online and needs 3 failed pings (25 s apart) to say offline. Until then (up to about a minute) the menu copy shows read-only and the banner is hidden. Sales recorded before the reload are safe in the outbox.
- **After an offline unlock,** the offline session ends once the till is back online, and the cashier signs in again (decision B). Sync doesn't wait for that: it runs on the sign-in page too.
- **The drill checklist** for a real till is `2026-11-18-offline-outage-drill.md`.
