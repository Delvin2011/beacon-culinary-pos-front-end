# O2b frontend plan: receipt and kitchen-ticket printing

**Branch:** `feature/o2b-printing`, from `feature/o2-tills-frontend` at `fd79c09`. O2 isn't merged into `main`, and
O2b uses its till code and name, its session handling and its session-ending events.

**Contract:** `docs/2026-11-17-o2b-receipt-data-api-contract.md` and `docs/2026-11-17-o2b-frontend-handoff.md` (POS_BE,
`feature/o2b-receipt-data`). Neither is in this repo; the relevant sections were pasted during planning and are
summarised below. Every test mocks `fetch` to them.

**Approach:** Chrome or Edge in kiosk mode with silent printing (`--kiosk --kiosk-printing`) to an 80 mm thermal
printer set as the Windows default. Receipt first, then the kitchen ticket, on the same printer. No cash-drawer
integration. Setup: `docs/2026-11-17-till-printing-setup.md`.

## Decisions

1. **Order fields** (top level of `OrderDto`):
   - `receiptNumber`, `orderNumber`, `tillCode`/`tillName` (both null on the unregistered till), `cashierName`, `vatRate`/`vatIncludedAmount` (both null before O2b) and `originalTotal`.
   - On a payment, `amountTendered`, `changeDue`, `cardReference` and `accountId` are left out when they don't apply.
2. **Receipt settings** (`GET /pos/receipt-settings`, CASHIER or ADMIN):
   - every key is always present, and the response is 200 with defaults before anything is saved;
   - they're fetched once per sign-in and cached for the session;
   - any failure prints the receipt without a header, footer or VAT line.
3. **The VAT line:** one line under TOTAL, `Incl. VAT {rate}%: R {amount}` (`VAT_LINE_TEMPLATE` in `lib/receipt.ts`).
   - The rate is `vatRate × 100` without trailing zeros.
   - It's printed only when `showVatLine` is true and `vatIncludedAmount` isn't null.
   - VAT is never worked out on the till.
4. **Time:** `createdAt` is UTC without a zone suffix and is printed in Africa/Johannesburg time. `orderDate` isn't printed.
5. **Account names:** looked up by `payments[].accountId` in `GET /accounts`.
6. **Print queue:**
   - jobs run one after the other;
   - each moves on at `afterprint` or `PRINT_FALLBACK_TIMEOUT_MS` (2 s) after `print()` returns, whichever comes first.
7. **Auto-print:**
   - every sale is printed, a replay included, and each order id at most once per till session (`pos.autoPrinted` in sessionStorage);
   - a lock or `SESSION_ENDED` clears that list, and a different person's sign-in starts a new one.
8. **Admin reprint:** the full `OrderDto` plus `reprint`; the cashier and till are the original sale's, and the header comes from the current settings.
9. **Receipt settings dialog** (`GET` / `PUT /admin/receipt-settings`, ADMIN only), opened from Registered tills:
   - the PUT replaces everything, so unedited fields are sent back as GET returned them;
   - a 400 is a field map, which can hold several fields at once.

## What the till does now

### Printing after a sale (steps 2, 5)

- **When a sale succeeds** (the 201, or an O1 replay):
  - the till reloads `GET /orders/{id}`, as before;
  - it then prints the receipt, followed by the kitchen ticket if the order has a KITCHEN line;
  - if the reload fails, it prints from the POST response.
- **Printing never blocks or fails a sale.** It isn't awaited, and every error is swallowed.
- **The two switches**, "Print receipt automatically" and "Print kitchen ticket automatically":
  - are stored on each till in localStorage (`pos.printSettings`), both on by default;
  - an admin sets them on the till under **Registered tills → Printing on this till**;
  - clearing the browser data turns them back on.
- **Print again:** "Print receipt again" and "Print kitchen ticket again" are on the completion screen of the sale just finished.
  - They print from the order on screen, with no server call, marked "COPY" with no number.
  - **Next Customer** removes them, and an older order opened from today's list doesn't show them.
- **Unchanged:** "Mark Print Failed" and the admin reprint (numbered `COPY n`).

### Receipt (step 3)

- **`ReceiptView`** takes `{ order, settings, copy, accountNames }`.
  - It prints each part only when it has a value: an empty-settings slip is valid.
  - It's 72 mm wide with no margins, printed on the `RECEIPT80` page (`@page { size: 80mm auto; margin: 0 }`).
- **Order of the parts:**
  1. a copy mark (if any);
  2. the title, business name, address lines, `Tel …` and `VAT No. …`;
  3. `Receipt {receiptNumber}`;
  4. the order number, large;
  5. the local date and time, with `Till {code} · {name}`;
  6. `Cashier: …`;
  7. the lines, with every extra as sold (adjusted ones included);
  8. Subtotal and Discount (only when the discount isn't 0);
  9. TOTAL (`originalTotal`), then the VAT line;
  10. the payments: tendered and change, `Card ref …`, `Account: {name}`;
  11. the footer, with its line breaks kept;
  12. "Reprinted by …" and the copy mark.
- **Complimentary orders** print "Complimentary", the list value, TOTAL 0.00, the reason, the note and who approved it.
- **Amounts** print as `1 180.50` and `-10.00`, as on the handoff's slip.
- **O4** can pass a locally built order with no order number, receipt number or VAT values.

### Kitchen ticket (step 4)

- **Lines:** only the KITCHEN lines, with their extras and quantities, and no prices or notes.
- **Header:** a very large order number, the local time and the till code (when it isn't null).
- **When it's skipped:** if the order has no KITCHEN line, as with NONE- or BAR-only orders. BAR lines stay on the bar's screen.

### Admin (steps 6, 7)

- **Registered tills → Printing on this till:** the two switches, for the browser the page is open on.
- **Registered tills → Receipt settings** (a button next to "Register this till"; the page is ADMIN only) opens a dialog:
  - the fields: title, business name, 4 address inputs, phone, VAT number, a multi-line footer and the VAT-line checkbox;
  - "Last saved by … at …" in local time, hidden when both are null;
  - the handoff's limits checked before saving, and each 400 message shown under its field;
  - **Save** is enabled only when saving would change something (an undone edit or added spaces don't count); **Cancel** is always enabled and drops the edits;
  - a save closes the dialog, and a 400 keeps it open;
  - saving drops this browser's cached settings. Other tills read the new settings at their next sign-in.

## Tests

The suite has 419 tests, all passing; `tsc` and lint are clean. The O2b tests:

| File | Covers |
|---|---|
| `lib/receipt-settings.test.tsx` | parsing and defaults; null on 403, network failure or bad body; one fetch per sign-in, dropped on sign-out; the switches default on and each switches off |
| `hooks/use-print-queue.test.tsx` | receipt then ticket when `afterprint` never fires (the timeout); moving on at `afterprint`; the 80 mm margin-free page; carrying on when `print()` throws |
| `components/receipts/receipt-view.test.tsx` | header, `receiptNumber`, large order number, till, cashier, local time; VAT line, card reference, account name, tendered and change; no VAT line when `showVatLine` is false or `vatIncludedAmount` is null; `originalTotal` after a refund with adjusted extras; discount; complimentary 0.00 and reason; no till line on the unregistered till; empty and missing settings; an O4-style order; COPY n and COPY; a layout snapshot at 72 mm |
| `components/receipts/kitchen-ticket.test.tsx` | KITCHEN lines only, no prices; large number, time, till code; skipped for NONE- and BAR-only orders; COPY |
| `components/reports/receipt-reprint.test.tsx` | the admin reprint after a refund: `originalTotal`, original cashier and till, COPY 2, the current header, the account name |
| `components/pos/order-builder.printing.test.tsx` | receipt then ticket after a sale; printing without settings; each switch off; an order id auto-printed once; local copies say COPY with no number and use no server call; the buttons are gone after Next Customer |
| `components/devices/print-settings-card.test.tsx` | both switches on by default; each change is stored on this till |
| `components/devices/receipt-settings-dialog.test.tsx` | load, last-saved line (and hidden before the first save), Save enabled only on a real change and Cancel always enabled, Cancel saves nothing, save with every field and close, `receiptTitle` kept when not edited, a cleared field as null, several 400 field errors with the dialog kept open |
| `app/devices/page.test.tsx` | the Receipt settings button opens the dialog; Cancel closes it |

## Release checklist (handoff 9)

| Check | Where it's covered |
|---|---|
| A sale prints with every settings field empty | receipt-view (empty and missing settings) |
| Every field filled, with a 4-line address and a multi-line footer | receipt-view (header test) |
| The VAT line only when `showVatLine` is true, never before O2b | receipt-view |
| Complimentary prints 0.00 and the reason | receipt-view |
| A reprint after a refund shows `originalTotal`, the original cashier and till, and the copy number | receipt-reprint |
| The receipt time is local | receipt-view, kitchen-ticket |
| Saving without touching `receiptTitle` keeps it | receipt-settings page |
| A 400 shows under the right field | receipt-settings page |
| Adjusted extras still print, and the lines add up to `originalTotal` | receipt-view, receipt-reprint |
| No kitchen ticket for NONE only; a mixed ticket lists only KITCHEN | kitchen-ticket, order-builder printing |
| A local "Print receipt again" says COPY with no number, and the buttons go at the next sale | receipt-view, order-builder printing |

**Still to check on a real till:** the kiosk shortcut, the driver's paper and cut settings, the headers and footers, and
how long the printer takes. Use the setup guide's test sale.

## Risks and open points

- **`afterprint` with kiosk printing:** the 2 s fallback is a guess.
  - If the printer is slow, the browser queues both jobs anyway.
  - If two jobs ever merge or swap, raise `PRINT_FALLBACK_TIMEOUT_MS`.
- **Lost paper isn't detected.** "Mark Print Failed" stays manual.
- **The cached settings on a till** are those of its last sign-in. A change from the admin screen reaches each till at its next sign-in.
- **The guard after a plain sign-out:** the same person signing in again keeps the auto-printed list. This only prevents a second automatic print.
- **`rungBy`:** the contract says `OrderDto` has `cashierName`/`cashierId` and no `rungBy`. The order builder still reads `rungBy` for "Rung by" and the admin chip on today's orders and the completion screen. It was left as it is, because O2b didn't change it. If `rungBy` isn't sent, those lines are blank, and moving them to `cashierName` would need the cashier's role for the chip.
- **The accountant** still has to confirm the receipt title and the `receiptNumber` format. Neither needs a frontend change.

## Commits

1. `e0192fe` receipt settings cache and per-till auto-print switches
2. `bc3309c` print queue and the margin-free receipt page
3. `d5001ee` generalised receipt from the order and the receipt settings
4. `3dcbc71` kitchen ticket
5. `247c5c2` auto-print after a sale and print-again buttons
6. `aad0fdd` per-till switches on the devices page
7. `f8968f1` admin Receipt settings screen
8. `c9c2238` this document and the till setup guide
9. receipt settings moved from their own page and sidebar item into a dialog on Registered tills (Save only when changed)
