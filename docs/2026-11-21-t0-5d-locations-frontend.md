# Stock locations: frontend (T0-5d)

Branch `feature/infustructureUpdatesFE`. Builds against the backend's T0-5c (`feature/infrastructureUpdatesBE`, V115).

- Contract: [2026-11-21-t0-5c-locations-api-contract.md](2026-11-21-t0-5c-locations-api-contract.md)
- The model in prose: `docs/2026-11-21-stock-locations.md` in the **backend** repository (linked, not copied, so it
  can't drift).

Until now the screens assumed two locations, "Main Store" and "Kitchen", by name. Now there is one **primary**
location and any number of **secondary** ones, and every screen takes names and kinds from the API. With only the two
seeded locations, what users see is the same apart from the new admin screen and a few clearer labels.

## 1. The rules the screens follow

- The primary is found by `kind === "PRIMARY"`, never by name or id. Names always come from the API.
- Branch on `code` (and `details.reasons`) only, never on message text. Where the API sends a message without a code
  (waste, stock take, approving an ISSUE past stock), it is shown as it is.
- Pickers use `GET /locations` (active only, display order). History filters use `?includeInactive=true`.

## 2. Admin → Stock locations (`/stock-locations`, ADMIN only)

The menu entry and the page are hidden from every other role (they get 403 from `/admin/locations`). Signing in again
returns to the page.

**Locations tab**

| What | How |
|---|---|
| List | `GET /admin/locations`, display order: name, Primary/Secondary, Active/Inactive, "{n} ingredients in stock" and "{n} below zero" when > 0, what it's assigned to |
| Add | Name only (required, ≤ 50). A new secondary goes last |
| Rename | Any location, the primary too. `LOCATION_INVALID` → `details.fields` next to the field; `LOCATION_NAME_TAKEN` → "Another active location is already called {name}." |
| Move up/down | Two `PUT /admin/locations/{id}` swapping the sort orders, the moved row first; reload after. If the second fails: "The move was only half done: {moved} moved, but {other} didn't (…)". Equal sort orders: one PUT, the moved row gets the other's value −1 (up) or +1 (down), within 0–9999 |
| Deactivate | Confirm first. `LOCATION_DEACTIVATE_REFUSED` lists every reason in `details.reasons`, in order: PRIMARY; HAS_STOCK (count, the lines sent, "the N largest are shown", how to clear it: waste it or count it to zero); ASSIGNED (one line per job, link to the assignments); OPEN_STOCK_REQUESTS and OPEN_STOCK_TAKES (each id linked). An unknown reason is shown by its code |
| Activate | `LOCATION_NAME_TAKEN`, `LOCATION_LIMIT_REACHED` |
| The maximum | `LOCATION_LIMIT_REACHED` → "This site can have at most {maxActive} active locations, the primary included. Deactivate one first." with a link to Admin → Settings. The setting `stock.locations.max-active` now shows in a **Stock** group there, labelled "Most active stock locations" |
| 404 `LOCATION_NOT_FOUND` | Closes the dialog and reloads the list |

The primary has no Deactivate button ("Always active").

**Assignments** (same tab, anchor `#location-assignments`)

- Production location: "Where the daily planning issue sheet sends ingredients (from {primary})."
- Source per sales station: Kitchen, Bar, Handed over at the till. "Sales at this station take their stock from here."
  Under Bar and Handed over at the till: "Bar items and items handed over at the till don't use stock yet; this
  applies once they do."
- Choices: active secondaries from `GET /admin/locations`. Save sends only what changed; nothing changed → "Nothing to
  save" without a request. `ASSIGNMENT_NOT_SECONDARY`, `LOCATION_INACTIVE`, `LOCATION_NOT_FOUND` reload the
  assignments and the list and ask to choose again; `LOCATION_INVALID` → "Nothing to save".

**Changes tab** (`GET /admin/locations/history`): when, who, location, action, and what changed (created as …, renamed
from … to …, order a → b, deactivated, activated, "now the bar station's source (was …)"). Newest first; filter by
location (inactive ones marked); 50/100/200 per page; tab, filter and page kept in the URL.

## 3. Stock screens

| Screen | Change |
|---|---|
| GRV capture and bulk upload (Inventory) | "Received into {primary}"; no location choice |
| New ISSUE request (stock-movement station) | Picker of active **secondaries** only, labelled "Requesting location"; "Supplied from {primary}" and "From {primary} to {chosen}". Exactly one secondary → preselected; otherwise the user chooses. `locationId` is always sent. `ISSUE_LOCATION_NOT_SECONDARY`, `LOCATION_INACTIVE`, `LOCATION_NOT_FOUND` → the picker reloads, a choice no longer offered is cleared, the lines are kept, "choose again". No secondary at all → says so |
| Stock-movement landing | "Request stock to be issued from {primary} to your location." |
| Stock request review | ISSUE: "From {primary} to {locationName}"; the cap column is "{primary} Stock", the primary's figure found by kind. The over-stock approval error is shown as the API words it |
| Stock request lists | Unchanged: they already show `locationName`, which the API now fills for ISSUE too |
| WASTE requests, direct waste, stock takes | Unchanged: every active location, primary included, in display order |
| Ingredient stock (Inventory) | `byLocation` as the API orders it; the primary marked "(primary)", a deactivated location still holding stock "(inactive)". All shown |
| Legacy stock take (Inventory) | "Expected stock ({primary})", the primary's figure by kind |
| Pending stock takes | Filtered on the server (`?status=SUBMITTED`); a Location filter (`&locationId=`) from `?includeInactive=true`, deactivated ones marked; kept in the URL |
| Stock take review (variance) | Unchanged: it already shows the stock take's location and its expected / actual / variance |
| Daily planning, ingredient requirements | Columns "{primaryLocation.name} stock" (`currentStock`, new column) and "{productionLocation.name} stock" (`kitchenStock`). After confirming: "Issue sheet sent for approval: from {primary} to {production}" (plus "(request #n)" when the response has `stockRequestId`). Shortfalls: "Short at {primary}: …" — they're measured at the primary |
| Light-meal stock review (catalogue, planning, dashboard) | Columns "At {sourceLocationName}" and "{primary}"; "{source} doesn't have enough to make one unit." |
| Light-meal Request stock | "Issued from {primary} to {source}"; sent with `locationId = sourceLocationId` (nothing when null: not tracked, nothing to issue). `LOCATION_INACTIVE` → says so and reloads the review |
| Catalogue (low-stock level), dashboard light-meal card | Wording: "its source location" instead of "the Kitchen" |

## 4. Hard-coded names removed

| Where | Was | Now |
|---|---|---|
| `src/app/inventory/page.tsx` (legacy stock take) | `Expected stock (Main Store)`, `locationName === "Main Store"` | primary's name; figure by kind |
| `src/app/inventory/stock-requests/[id]/page.tsx` | `locationName === "Main Store"`; header "Main Store Stock" | by kind; "{primary} Stock" |
| `src/app/stock-movement/page.tsx` | "from Main Store to Kitchen" | "from {primary} to your location" |
| `src/app/daily-planning/page.tsx` | "Kitchen Stock", "Main Store to Kitchen", "deducted from Kitchen", "short in Kitchen" | names from the response |
| `src/components/catalog/stock-review-panel.tsx` | "In Kitchen", "Main Store", "The Kitchen doesn't have enough" | source and primary names |
| `src/components/catalog/request-stock-dialog.tsx` | "Issued from the Main Store to the Kitchen", "In Kitchen", "Main Store", "Main Store has only", "the Kitchen can't cover" | source and primary names |
| `src/components/inventory/line-item-sheet.tsx` | `defaultLocationNameByIndex` (default by name; unused) | `defaultLocationIdByIndex` (by id) |
| `src/app/catalog/page.tsx`, `src/components/dashboard/sections-lists.tsx` | "the Kitchen can make" | "its/each meal's source location" |
| `src/lib/light-meal-stock.ts`, `src/lib/roles.ts` | comments "Main Store → Kitchen" | primary → source / secondary |

No test fixture assumed location ids 1 and 2. The new fixtures (`src/lib/locations.test-fixtures.ts`) use other names
and ids (Central Store #3, Hot Line #4, Coffee Station #7) so tests pass only if the app takes both from the API.

**Kept** (a station or a screen, not a location): the `KITCHEN` station and its label "Kitchen"; the kitchen display
and its sign-in; kitchen tickets and printing; the bar board's meal chip; `stations.ts`; staff role descriptions;
"the kitchen gets this order". The API's field names `kitchenStock`, `kitchenAvailable`, `mainStoreAvailable` are kept
as they are.

**The check**: `src/lib/no-hard-coded-locations.test.ts` scans the app's source (not tests or fixtures) for "Main
Store" in any form (comments included), Kitchen used as a place ("the/in/into/from/to/at Kitchen", "Kitchen stock",
"Kitchen's", "Kitchen can"), a location found by name (`locationName === "…"`), and a location id in code
(`locationId: 2`). By hand:

```sh
grep -rniE "main ?store|(the|in|into|from|to|at) Kitchen|Kitchen (stock|can)|Kitchen('|&apos;)s|locationName *[!=]==? *[\"'\`]" src --include=*.ts --include=*.tsx | grep -v "\.test\.\|test-fixtures"
```

## 5. Files

**New**: `src/lib/locations.ts` (+ `.test.ts`, `.test-fixtures.ts`), `src/app/stock-locations/page.tsx` (+ test),
`src/components/stock-locations/` (`locations-list.tsx`, `location-form-dialog.tsx`, `location-status-dialog.tsx`,
`deactivate-refused.tsx`, `assignments-section.tsx` + test, `locations-history.tsx` + test),
`src/components/app-sidebar.stock-locations.test.tsx`, `src/components/inventory/line-item-sheet.test-fixtures.tsx`
(test-only Select and ingredient picker stand-ins), `src/components/inventory/line-item-sheet.locations.test.tsx`,
`src/app/stock-movement/issue/new/page.test.tsx`, `src/app/inventory/stock-takes/page.test.tsx`,
`src/app/daily-planning/page.locations.test.tsx`, `src/components/catalog/stock-review-panel.locations.test.tsx`,
`src/lib/no-hard-coded-locations.test.ts`, this doc and the contract copy.

**Changed**: `src/hooks/use-locations.ts`, `src/lib/return-to.ts` (+ test), `src/components/app-sidebar.tsx`,
`src/lib/site-settings.ts`, `src/components/inventory/line-item-sheet.tsx`, `src/app/stock-movement/issue/new/page.tsx`,
`src/app/stock-movement/page.tsx`, `src/app/inventory/stock-requests/[id]/page.tsx`, `src/app/inventory/page.tsx`,
`src/app/inventory/stock-takes/page.tsx`, `src/app/daily-planning/page.tsx`, `src/lib/light-meal-stock.ts`,
`src/components/catalog/stock-review-panel.tsx`, `src/components/catalog/request-stock-dialog.tsx`,
`src/app/catalog/page.tsx`, `src/components/dashboard/sections-lists.tsx`, `src/lib/roles.ts`.

## 6. Open questions for the backend

1. **`active` on `GET /locations?includeInactive=true`**: the contract's example has no `active` field. The stock
   takes filter marks a location "(inactive)" when it is missing from the plain (active-only) list, so it works either
   way; sending `active` would save the second request.
2. **`stockRequestId` on the planning confirm response**: the contract says "no new fields". The success line adds
   "(request #n)" only when the response has it. Adding it would let the line link to the issue sheet.

## 7. Gaps

- **No stock list across all ingredients by location.** Figures exist per ingredient (`GET
  /admin/ingredients/{id}/stock`) and per stock take; that covers every screen here. A report of stock per location
  over all ingredients would need a new endpoint.
- **No location filter on waste or stock-request history**: `GET /admin/waste` and `GET /stock-requests` don't take a
  location (contract section 3). Only pending stock takes have one.
- **Inventory page tests**: the 3,000-line page has no page test; its changes are covered through the helpers
  (`formatStockByLocation`, `primaryStock`) and the line item sheet test.
- **Moving stock between locations (IBT)** is a later phase; the HAS_STOCK refusal says to waste the stock or count it
  to zero.

## 8. Tests

`npx vitest run` — the suite passes. The new tests:

- Admin screen: list (summary, assignments, inactive), add, name check, rename (primary; field error; name taken),
  the maximum on create and activate, move (two PUTs; the second failing; equal sort orders), deactivate refused for
  each reason and for all at once, activate, the Changes tab, STOCK_ADMIN sent away, a 403 explained, the menu entry
  for ADMIN only.
- Assignments: only active secondaries offered, explanations, only changes sent, each error code.
- Changes: rows in words, filter, paging, URL.
- ISSUE request: secondaries only, primary as supplier, preselection, `locationId` sent, each refusal code reloads.
- Line item sheet: GRV shows the primary with no picker; WASTE, waste and stock take pickers offer all active
  locations.
- Stock by location: three locations in order, the primary and an inactive one marked; the primary found by kind.
- Pending stock takes: server filter, location filter with inactive marked, URL.
- Planning and light-meal labels from the API; the batch sent to the source; `LOCATION_INACTIVE` reloads.
- No hard-coded location names.
