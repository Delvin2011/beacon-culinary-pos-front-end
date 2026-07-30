# Phase 1 Frontend Development Spec — Canteen POS (Set-Meal Model)

Cashier-facing counter UI. Staged to match the backend spec 1:1 — each stage below depends only on the matching backend stage's endpoints, so frontend and backend can ship together, stage by stage, rather than frontend waiting for the whole backend to finish. Target device: tablet/touchscreen at a counter.

This document does **not** yet cover the offline-PWA behavior — that's a later phase. For now, assume a connected terminal.

---

## Stage 1.1 — Login & Shift Screens

### Scope

- PIN entry screen (numeric keypad UI, large touch targets — no physical keyboard assumed)
- Shift-open screen: prompt for opening float amount before the cashier can do anything else
- A persistent "shift open" indicator somewhere in the UI chrome once active
- Shift-close action (simple confirm — no reconciliation UI yet, that's a later stage)

### Flow

1. App loads → checks for a valid session; if none, show PIN entry.
2. On successful PIN login → call `GET /shifts/current`. If `404`, show "Open Shift" screen (float amount input). If a shift is already open, skip straight to the main app.
3. Opening a shift (`POST /shifts/open`) transitions into the main cashier app.
4. A visible "Close Shift" action (e.g. in a header menu) calls `POST /shifts/{id}/close` and returns to PIN entry.

### Acceptance criteria

- [ ] Wrong PIN shows a clear, generic error ("Incorrect PIN") without revealing whether the cashier ID exists.
- [ ] Cashier cannot reach the order screen without an open shift.
- [ ] Attempting to open a second shift (backend `409`) shows a clear message rather than a raw error.
- [ ] Shift status persists across a page refresh (re-check `GET /shifts/current` on load, don't just trust local state).

### Test scenarios

- Correct PIN + no open shift → routed to "Open Shift" screen
- Correct PIN + shift already open → routed straight to main app
- Wrong PIN → error shown, stays on login
- Refresh mid-session → session and shift status both correctly rehydrated from the API, not lost
- Close shift → returns to login, subsequent PIN login goes to "Open Shift" again

---

## Stage 1.2 — Admin Catalog Management + Daily Planning Screens

### Scope

Two separate, basic (utilitarian, not polished) admin screens:

1. **Catalog management** — infrequent, low-traffic: create/edit meal-catalog entries (name, description, price, linked components) and component-catalog entries (name, extra price). This is where prices are set — never re-entered elsewhere.
2. **Daily planning** — used once per day by the chef: pick from the catalog, declare quantities. No price fields appear on this screen at all — price is inherited and shown read-only.

### Flow — Catalog management

- Simple list + create/edit form for `meal_catalog` (name, description, price, checkbox-select linked components from `component_catalog`) and a separate list + form for `component_catalog` (name, extra price).
- This screen changes rarely — prioritize correctness over polish.

### Flow — Daily planning

- **Meal option form:** select meal period (Breakfast/Lunch), select a catalog meal from a dropdown (shows its predefined price for confirmation, read-only), enter `plannedPortions`. Submit → `POST /admin/daily-options`.
- **Component stock form**, separate from the above: select meal period, select a catalog component from a dropdown (shows its predefined extra price, read-only), enter `bufferQuantity`. Submit → `POST /admin/daily-component-stock`. This is **not** tied to a specific meal option in the UI — it's its own daily declaration.
- A combined "today's plan" list view (`GET /menu/today?period=`) showing both the day's meal options and the day's component stock, so admin can see the full picture and avoid duplicate entry.
- **No replenish action.** Once portions or component stock hit zero, they're sold out for the day — the only way to add more is to plan again tomorrow. Getting the day's quantities right the first time is a chef/ops responsibility this screen supports (by showing sales trends over time, in a later phase), not something the UI offers a workaround for.

### Acceptance criteria

- [ ] Creating a meal-catalog entry with linked components makes it selectable in the daily-planning dropdown.
- [ ] Selecting a catalog meal in daily planning shows its price as read-only — there is no price input field anywhere on this screen.
- [ ] Submitting a daily option with only `plannedPortions` set creates it, and it appears in the today-list with the correct catalog-derived name/description/price.
- [ ] Component stock can be created independent of any specific meal option.
- [ ] Non-admin users cannot reach either screen (route-gated by role, in addition to the backend's `403`).

### Test scenarios

- Create a meal-catalog entry with 2 linked components → appears in daily-planning dropdown
- Create a daily option by selecting a catalog meal → today-list shows correct snapshotted name/description/price
- Create component stock unlinked to any specific option → appears correctly in today's plan
- Cashier-role user attempts to navigate to either screen → redirected/blocked

---

## Stage 1.3 — Order Builder & Cash Checkout

### Scope

This is the core of Phase 1. No server-side draft (matches the backend design) — the in-progress order lives in frontend state.

### Flow

1. On load, call `GET /menu/today?period=` (auto-detect current period, or let cashier switch between Breakfast/Lunch tabs if both are active) and render today's options as large tappable cards, each showing name, price, and remaining portion count.
2. If `portions_remaining` is low (e.g. under a visible threshold like 10), show a subtle low-stock badge on the card — this doesn't block selection, just signals to the cashier.
3. If `portions_remaining = 0`, grey out the card, disable selection.
4. Tapping an option opens a quantity + extras panel:
   - Quantity stepper (default 1)
   - Extras: checkboxes drawn from the meal period's **full shared extras list** (`availableExtras` from `GET /menu/today`) — not limited to that option's own composition. A customer buying Potatoes & Beef can still tick "extra Chicken" here. Each shows its `extraPrice` and is greyed out if `buffer_remaining = 0`.
   - "Add to Order" button
5. Order panel (sidebar/bottom sheet) lists current lines with running subtotal.
6. "Charge" button opens a cash-tendered input (numeric keypad), shows the total, and requires an amount ≥ total before enabling "Confirm Payment."
7. On confirm, `POST /orders`. Show a loading state; disable the button to prevent double-submission on a double-tap.
8. **On success (`201`):** show a clear confirmation screen — order number (large), change due (large, since this is the number the cashier reads aloud), and a "Print Receipt" action (see Stage 1.4). Clear the order state and return to the option grid for the next customer.
9. **On `409` (stock conflict):** identify the specific line/extra that failed (from the API error body), remove or grey out just that part of the order, and let the cashier adjust and retry — don't discard the whole order.
10. **On `400` (underpayment, closed window, etc.):** show the specific validation message inline, not a generic toast.
11. **On network failure:** keep the order intact in state, offer retry — don't clear it.

### Acceptance criteria

- [ ] A full cash sale completes end-to-end: select option → add extra → charge → confirm → see order number and correct change due.
- [ ] Zero-stock options are visibly disabled and cannot be added to an order.
- [ ] Low-stock badge appears at the agreed threshold without blocking the sale.
- [ ] Double-tapping "Confirm Payment" does not create two orders.
- [ ] A `409` response identifies the specific failing item to the cashier, not just a generic failure.
- [ ] Change-due calculation displayed matches what the API returns exactly (frontend must not independently compute and display a different figure).

### Test scenarios

- Happy path sale, one option, one extra, exact cash tendered
- Happy path sale, cash tendered greater than total, correct change shown
- Select an option, then add an extra belonging to a **different** dish's usual composition (same meal period) → succeeds, priced correctly (confirms extras aren't limited to the chosen dish)
- Attempt to add a zero-stock option → prevented in UI
- Attempt "Confirm Payment" with tendered amount less than total → button disabled or blocked with message
- Double-tap "Confirm Payment" under simulated slow network → only one order created (verify via network inspection or mocked API call count)
- Simulate `409` from API → correct item flagged, rest of order intact, cashier can retry
- Simulate network failure on submit → order state preserved, retry available

---

## Stage 1.4 — Receipt Display & Order Lookup

### Scope

- On-screen receipt view (since printing is best-effort and must never block the flow) rendered from `GET /orders/{id}`.
- A "Today's Orders" screen (`GET /orders/today`) for the cashier to look up and reprint/redisplay any earlier order in the shift — useful if a customer loses their printed receipt or the printer failed originally.
- A "mark print failed" action if the physical printer errors, so it's logged (`POST /orders/{id}/mark-print-failed`) — this is a small manual button the cashier taps, not automatic detection (no assumption about printer integration specifics at this stage).

### Flow

1. After a successful order (from Stage 1.3), attempt to send to the physical printer (implementation detail depends on the actual printer/hardware SDK in use — out of scope to fully specify here). If printing fails or the printer isn't available, show the on-screen receipt clearly and call `mark-print-failed`.
2. On-screen receipt always shows: order number (large), date/time, line items with quantities and extras, subtotal, total, amount tendered, change due.
3. "Today's Orders" screen: simple list (order number, time, total), tap to view/reprint any order's full receipt.

### Acceptance criteria

- [ ] Every completed order can display an on-screen receipt regardless of printer status.
- [ ] A failed print attempt logs via `mark-print-failed` without affecting the order itself.
- [ ] "Today's Orders" list correctly shows all of the current shift's orders and supports drilling into any one of them.

### Test scenarios

- Successful order → on-screen receipt renders all fields correctly
- Simulated printer failure → `mark-print-failed` called, on-screen receipt still shown as the fallback
- Navigate to "Today's Orders," select an earlier order, confirm correct detail is displayed
- Order lookup for a nonexistent/invalid ID handled gracefully (not a blank/broken screen)

---

## Explicitly Out of Scope for Phase 1 Frontend

- Offline/PWA behavior (later phase)
- Kitchen display, public display board (Phase 2)
- Card payment UI (later phase)
- Cash drawer reconciliation UI (Phase 2)
- Refund/void/discount UI (Phase 2)
- Any replenishment UI — depletion is permanent for the day by design
