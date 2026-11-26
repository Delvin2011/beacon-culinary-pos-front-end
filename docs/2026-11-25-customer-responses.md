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

## 7. The customer's name and TENANT_MISMATCH (T1-8)

Nothing customer-specific is built into the frontend. A guard (`src/lib/no-hard-coded-brand.test.ts`) fails on
"beacon" in any case in `src` or `public`. Tests, fixtures and mocks are excluded, and so is the generated
`public/sw.js`. One line is allowed: the offline database's name `beacon-pos-offline`. Renaming it would leave every
till's grant, snapshot and unsynced outbox behind.

**Where the name comes from.** `GET /api/public/branding` (no sign-in, `{ name, logoUrl }`), called once per page
load through `apiFetch` with `credentials: "omit"` (`src/lib/customer-branding.ts`, started in `Providers`, read with
`useCustomerBranding()`). Every screen shows it:

- `/login`: the heading;
- the back office: the sidebar's team name and group label;
- the POS: the header, the sign-in and the offline unlock;
- the kitchen and bar displays and their sign-ins;
- the board and the invite page;
- the browser tab title.

The logo shows on `/login` and in the sidebar only when `logoUrl` isn't null. The receipt prints the receipt
settings' business name when it is set, otherwise the customer's name. The static title is the neutral
"Canteen POS". There is no PWA manifest.

**Offline and fallback.** A valid answer is remembered on the device (`localStorage`, key `pos.customer-branding`).
Storage belongs to the origin, so each customer address keeps its own. Until the answer arrives, or when it fails
(offline, suspended, unavailable, unknown address, a bad body), the screens use the remembered name. With nothing
remembered they use **"Canteen POS"**, never another customer's name. The till and its offline receipts use the
remembered name.

**401 `TENANT_MISMATCH`** (a credential that belongs to another customer) is read as `SESSION_ENDED` with no reason
(`readSessionEnded`, `src/lib/till.ts`):

- back to sign-in with "Your session has expired. Please sign in again.";
- no refresh and no retry, and no error page;
- only the tokens are cleared: the cart, the outbox, the grant, the unlock value and the snapshot are kept.

The offline sync and the heartbeat (device cookie, no token) treat it as any other refused answer: they try again
later and the outbox is kept.

| Tests | Where |
|---|---|
| Fetch once, remember, fallback, a fresh address, failures | `src/lib/customer-branding.test.ts` |
| Each screen and the tab title | `src/components/customer/customer-name.screens.test.tsx`, `src/lib/brand.test.tsx`, `src/components/login-form.brand.test.tsx` |
| The till offline (remembered / neutral / from the endpoint); the receipt | `src/app/pos/offline-reload.test.tsx`, `src/components/receipts/receipt-view.test.tsx` |
| `TENANT_MISMATCH` (a call, refresh, the kitchen back to its sign-in; offline data and outbox kept) | `src/contexts/auth-context.tenant-mismatch.test.tsx` |
| The guard | `src/lib/no-hard-coded-brand.test.ts` |
| e2e: two customers on two addresses, each with its own name (sign-in, title, till, receipt); a fresh address neutral; a known one offline | `e2e/customer-name.spec.ts` (`e2e/mock-api.ts`: `branding`, `appUrl`) |

**For the backend:**

- `/public/branding` follows the three customer responses above (suspended, unavailable, unknown address).
- `TENANT_MISMATCH` comes as a 401 with a JSON `code`.
- A long `name` is shown in full (truncated in the sidebar).
