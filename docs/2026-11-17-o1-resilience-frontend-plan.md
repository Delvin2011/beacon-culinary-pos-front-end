# O1 frontend plan: resilience and duplicate-safe sales

Branch: `feature/o1-resilience-frontend`, from `main` at `2825350` (WS1-1b merged in PR #5). Built against the
backend contract `docs/2026-11-16-o1-resilience-api-contract.md` (POS_BE, branch `feature/o1-resilience`, not yet
deployed). Until it is, every test mocks `fetch` to follow the contract. Approved 2026-11-16, built 2026-11-16 to 17.

## Decisions

- **Printing is not part of O1.** The sale flow has no automatic print today. A completion hook (`onCompleted` in
  `usePendingSale`) runs once per `clientOrderId`; receipt and kitchen-ticket printing should hook in there.
- **Void and refund ids live in memory only.** They don't survive a reload. Pressing again with the same order,
  action, scope, reason and note reuses the id.
- **Another cashier's pending sale blocks the till** until that cashier signs in or a supervisor clears it. The
  server would refuse it from anyone else anyway (409 `IDEMPOTENCY_CONFLICT`), so it is never resent.
- **"Supervisor: clear it"** (manager PIN) is offered when a sale is unconfirmed, in conflict, or someone else's.
  Clearing doesn't cancel the sale: if the server got it, it stays recorded. The screen tells the supervisor to
  check Today's orders before ringing it again.
- **A 400 from `/auth/refresh` still signs the user out**, as well as a 401.
- **The shift refetches quietly:** a refetch with a shift already shown doesn't blank the screen.
- **Selling offline is not part of O1.** While offline, Confirm says "Waiting for connection" and the cart is kept.

## Behaviour

### Timeouts and failure kinds (`lib/net.ts`)

- **Timeouts:** 15 s by default, 20 s for `POST /orders`, 5 s for `/health`. Built with `AbortController` and a
  timer, not `AbortSignal.timeout`.
- **Failure kinds:** every failure is network, timeout, server (5xx), rate-limited (429) or http.
  `messageForError` turns anything fetch threw into a plain message ("Can't reach the server. Nothing has been
  lost. Try again."). POS screens never show "Failed to fetch".

### Blips (steps 2 and 3)

- **Token refresh:** only a 401 or 400 from `/auth/refresh` signs out. A network error, timeout or 5xx keeps the
  session and fails just that request. A 429 blocks further refreshes until `Retry-After`.
- **Menu:** a failed refresh of the same meal period keeps the menu, with "Last updated hh:mm. Couldn't refresh
  the menu; stock shown may be out of date."
- **Shift:** only a 404 from the shift lookup sends the till to "Open shift". Any other failure keeps the last
  known shift, with a Retry banner; with no shift loaded, it shows "Can't reach the server".
- **Sign-in:** the POS sign-in page shows friendly messages, with a "Try again" button for the cashier list.

### Connection indicator (step 4)

- **Ping:** `GET /health` every 25 s (every 10 s while offline), plus signals from every request.
- **Hysteresis:** offline after 3 failures and online after 2 successes, with signals less than 1 s apart counted
  once.
- **What counts as offline:** a network error, a timeout, or a 502/503/504 (including 503 `DOWN` from `/health`).
  A 500 is a bug, not an outage, and is ignored. A 404 from `/health` (today's servers) is ignored too, so
  requests decide until O1 is deployed.
- **Header badge:** "Online", "Offline" or "Server unavailable". Tapping it checks again.

### Duplicate-safe confirm (step 5)

- **Confirm** freezes the request body, adds `clientOrderId` (`crypto.randomUUID`, with a `getRandomValues`
  fallback) and stores both in `localStorage` (`bar-talk.pendingSale`). This applies to sales and complimentary
  orders alike.
- **While it is pending,** a full-screen "Checking the sale…" covers the till and lists the items and total.
  Nothing can be edited and no new sale can start.
- **Retries:** the same body and id are resent after a network error, timeout, 5xx, 429 (`Retry-After` honoured)
  or 409 `ORDER_NUMBER_CONFLICT`. The waits are 1, 2, 4, 8 and 16 s. When they run out: "Sale not confirmed yet.
  Don't ring it again.", with Check again. The sale is resent when the connection comes back and on app start.
- **201, or 200 with `Idempotent-Replay: true`,** completes the sale. `completedIds` (the last 50) makes it complete
  once per id. A replay adds "This sale had already gone through. It was recorded once."
- **409 `IDEMPOTENCY_CONFLICT`** is never retried. The sale is kept for a supervisor.
- **401 `AUTHORIZATION_INVALID`** asks for the manager PIN again and resends with the same id; only the
  `authorization` token changes, and the server's fingerprint ignores it. The cashier can also go back to the
  order instead, since nothing was recorded.
- **Other refusals** (`NO_OPEN_SHIFT`, `TILL_IN_USE`, stock, validation): nothing was created. The pending sale is
  cleared and the same handling as before O1 runs, with the cart kept.

### Duplicate-safe voids and refunds (step 6)

- **Every adjustment sends a `clientRequestId`.** A network error, timeout, 5xx or 429 resends the same body and id
  after 1, 2 and 4 s.
- **If the outcome is still unknown,** the id is kept. The message is "Couldn't confirm the void or refund. Check
  the order, then press it again: it won't be applied twice."
- **409 `IDEMPOTENCY_CONFLICT`** is never retried, and the next press gets a new id. A 200 replay shows the normal
  success message.

## Tests

All tests use Vitest and Testing Library, with `fetch` mocked to the contract. 292 tests pass; `tsc` and lint are
clean.

| File | Covers |
|---|---|
| `lib/net.test.ts` | timeouts, failure kinds, Retry-After, friendly messages |
| `contexts/auth-context.timeout.test.tsx` | request timeouts; requests report connection signals |
| `contexts/auth-context.refresh-resilience.test.tsx` | which refresh failures sign out; 429 Retry-After block |
| `contexts/auth-context.pin-login.test.tsx` | friendly PIN sign-in messages |
| `app/pos/login/page.test.tsx` | cashier list network error |
| `app/pos/shift-redirect.test.tsx` | only a 404 redirects to Open shift |
| `components/pos/order-builder.menu-stale.test.tsx` | menu kept with "Last updated" |
| `contexts/connection-context.test.tsx` | hysteresis, 503 `DOWN`, 404 ignored, coalescing |
| `components/pos/order-builder.offline.test.tsx` | Confirm waits for the connection; cart kept |
| `lib/pending-sale.test.ts` | id, frozen body, storage, once per id, new approval, outcome rules |
| `hooks/use-pending-sale.test.tsx` | retries reuse id and body; 409 handling; PIN path; resume; other cashier |
| `components/pos/order-builder.pending-sale.test.tsx` | till locked; retry then 200 replay completes once; reload |
| `components/pos/order-builder.adjustment-idempotency.test.tsx` | void retries; second press replays; conflict |
| `components/pos/order-builder.no-raw-errors.test.tsx` | no "Failed to fetch" on the till or the shift reading |

## Risks and open points

- **Clearing a sale while the server is down.** If the sale did reach the server and is rung again, it is
  recorded twice. The supervisor is told to check Today's orders first.
- **Storage blocked or full.** The sale still goes out and is retried, but it won't survive a reload.
- **Void and refund ids are lost on reload.** A void whose answer was lost and then re-done after a reload gets a
  new id. The server's existing "already adjusted" 409 still protects whole-order voids and refunds.
- **Until the backend ships `/health`,** the indicator relies on request signals only.
- **When `pos.require-client-order-id` is switched on,** every till must already run this frontend, or its sales
  get 400 `CLIENT_ORDER_ID_REQUIRED`.
- **Back-office pages** (accounts, catalog, inventory, kitchen, bar) still show raw error text. They are outside
  O1's POS scope.

## Commits

1. `6ccf2f4` request timeouts and failure kinds
2. `a1b36c0` token refresh survives a blip
3. `c46e7b7` menu, shift and sign-in survive a blip
4. `e70522f` connection indicator
5. `f4c6f38` duplicate-safe confirm
6. `e3f018c` duplicate-safe voids and refunds
7. `252360d` no raw fetch errors on POS screens
8. this document
