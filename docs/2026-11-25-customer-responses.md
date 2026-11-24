# The customer's responses (T1-3, frontend)

The backend works out the customer from the address (T1-3). Three of its responses are about the customer, not about
one request. This is what the frontend does with each, on every screen. Builds on the API on the page's own address
(`docs/2026-11-24-relative-api.md`).

| Response | Means | Every screen | The POS |
|---|---|---|---|
| 503 `{ error, code: "CUSTOMER_SUSPENDED" }`, on every API path (`/health` and `/public/*` included) | The vendor suspended this customer | A full-page message: "This service is currently unavailable for this site. Please contact your administrator." with **Try again** | Indicator "Service suspended". Never goes offline, never sells offline, nothing is synced; the outbox is kept |
| 503 `{ error, code: "CUSTOMER_UNAVAILABLE" }`, on every API path (`/health` included) | Temporarily unavailable (e.g. its database is being updated) | Away from the POS: a banner, "Can't reach the server. Nothing has been lost. Try again." | An outage, as before (O1): "Server unavailable", then offline selling if the till is offline-ready |
| 404 with an empty body, on every path (`/health` included) | No customer has this address | A banner: "This address isn't set up." | The same banner; not offline |

None of them signs anyone out, empties a cart, or deletes stored offline data (grant, snapshot, PIN check value,
outbox). Screens keep their own error messages as well.

## 1. How every response is seen

Every API call goes through `apiFetch` (`src/lib/api-fetch.ts`), the only caller of `apiUrl`; a guard test
(`src/lib/no-backend-address.test.ts`) fails on any other. `apiFetch` reads a copy of each 503 and 404 body and
records what it says (`src/lib/customer-status.ts`, module state read with `useCustomerStatus()`).
`CustomerStatusGate` (`src/components/customer/customer-status-gate.tsx`), around every route in `Providers`
(`/board` and `/invite` included), shows the message and the banners.

## 2. CUSTOMER_SUSPENDED

- **The message** covers the screen. The screen stays mounted underneath, out of reach (`inert`, `aria-hidden`), so
  the session, the cart and a pending sale are exactly as they were when the suspension ends.
- **Nothing else is called.** `apiFetch` refuses every call without sending it (`CustomerSuspendedError`: not a
  network error, not a sign-out), and the loops wait instead of retrying: offline sync and the heartbeat, till
  status / grant / snapshot refresh, the pending sale (no retry used up), the kitchen, bar and board streams, the
  `/health` ping.
- **The only call** is one `/health` check every 60 s ± 15 s at random (`src/lib/customer-recovery.ts`), plus
  **Try again**, which checks at once.
- **It ends** when `/health` answers 200, or 503 `CUSTOMER_UNAVAILABLE` (then it is an outage). An empty 404 from
  `/health` ends it too and shows "This address isn't set up." No answer at all keeps it.
- **After it ends** the loops resume by themselves: sync sends the outbox, the displays reload, the ping starts
  again. Back-office screens (which load once) show "Service restored." with a **Reload** link. Not on the POS,
  kitchen, bar or board (they pick up again on their own), nor on the invite page (its token is gone from the
  address bar, so a reload would lose it).
- **The POS:** a suspended answer gives no online/offline signal (`src/lib/connection-signals.ts`), so the till keeps
  whatever state it had and offline selling never starts because of it; `sellingOffline` also requires "not
  suspended". The indicator shows "Service suspended" ahead of "Offline" and "Server unavailable". The heartbeat
  doesn't record a suspension as time offline.
- The idle auto-lock still runs during a long suspension; that is a lock (PIN to unlock), not a sign-out.

## 3. CUSTOMER_UNAVAILABLE

An outage, as any 503 already was: "Server unavailable" on the till after three answers, then offline selling when
the till is offline-ready. Away from the POS (back office, kitchen, bar, board, invite), the shared banner. It goes
on the next successful answer (or **Try again**).

## 4. An unknown address

The backend also answers an empty 404 for a missing record, so an empty 404 alone means nothing. `apiFetch`
confirms it with `/health` once (then not again for 5 s): only an empty 404 there too means no customer has this
address. The banner shows on any screen, the POS included; the call's own screen handles its 404 as before. Not a
sign-out (only a 401 starts a refresh) and not offline (a 404 proves the server answered).

## 5. Tests

| What | Where |
|---|---|
| Sorting answers; `apiFetch` (nothing sent while suspended; the `/health` confirmation); the recovery check (60 s ± 15 s, ends on 200 / unavailable / empty 404) | `src/lib/customer-status.test.ts`, `src/lib/api-fetch.test.ts`, `src/lib/customer-recovery.test.ts` |
| The connection signals and indicator | `src/lib/connection-signals.customer.test.ts`, `src/contexts/connection-context.customer.test.tsx` |
| The message, Try again, automatic recovery with nothing else called, the banners, "Service restored. Reload" | `src/components/customer/customer-status-gate.test.tsx` |
| Each response on the kitchen and bar displays, the board, a back-office page (meal periods) and the invite page | `src/components/customer/screens.customer.test.tsx` |
| The POS online and offline-ready: suspended never sells offline, unavailable does, the cart kept | `src/components/pos/order-builder.customer.test.tsx` |
| Sync and the heartbeat pause and resume; the outbox kept | `src/components/pos/offline-sync.customer.test.tsx` |
| The pending sale waits, then completes with the same body | `src/hooks/use-pending-sale.customer.test.tsx` |
| No sign-out; stored offline data kept | `src/contexts/auth-context.customer.test.tsx`, `src/contexts/offline-context.customer.test.tsx` |
| e2e: the POS receiving `CUSTOMER_SUSPENDED` mid-shift: the message, not offline, nothing called for 30 s, then Try again with the same cashier and cart | `e2e/customer-suspended.spec.ts` (`e2e/mock-api.ts`: `customer: "suspended"`) |

## 6. For the backend

- The three responses exactly as above; in particular `/health` answers `CUSTOMER_SUSPENDED` and
  `CUSTOMER_UNAVAILABLE` too, and an empty-body 404 at an unknown address.
- A suspended customer's `/health` is called at most about once a minute per open screen (one check every
  60 s ± 15 s), plus Try again presses.
