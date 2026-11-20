# Meal periods screen (T0-5b)

Admin → **Meal periods** (`/meal-periods`, ADMIN only). Lets an admin add, edit, deactivate and activate the meal
periods that set meals are planned and sold under, and shows who changed what. Built against
[the meal periods API contract](2026-11-20-t0-5-meal-periods-locations-api-contract.md), part 2. That file is a copy;
the backend copy is the source of truth. Locations (part 1 of that contract) moved to T0-5d.

**Branch:** `feature/t0-5b-meal-periods-locations-screens` is stacked on `feature/t0-4b-site-settings-screen`.
Both branches add an entry to the sidebar and to the return-to allowlist on the same lines, so **merge T0-4b first**.

## Where things are

| File | What |
|---|---|
| `src/lib/meal-periods.ts` | Types, API calls, the client copies of the field rules, the warnings before a save, refusal codes in plain words, history changes |
| `src/app/meal-periods/page.tsx` | Page: ADMIN guard, Periods / Change history tabs |
| `src/components/meal-periods/meal-periods-list.tsx` | The list and its actions |
| `src/components/meal-periods/meal-period-form-dialog.tsx` | Add and edit |
| `src/components/meal-periods/period-status-dialog.tsx` | Deactivate and activate |
| `src/components/meal-periods/meal-periods-history.tsx` | Change history |

## Behaviour

**List** (`GET /admin/meal-periods`, which includes inactive periods).
- **Order:** by `sortOrder`, then `id`.
- **Columns:** name, times (`HH:mm–HH:mm`, or "Always open"), Active/Inactive, sort order, and the last change (who, when, what).
- **Inactive periods:** greyed, with **Activate**.
- **The All Day period** (`allDay: true`): carries an "All-day period" badge and has no Deactivate button.
- **Note at the top:** changes apply immediately to the menu and selling; offline tills pick them up at their next update.

**Add and edit** (`POST /admin/meal-periods`, `PUT /admin/meal-periods/{id}`).

The contract's rules (section 4) are checked before sending, with the server's own wording:

| Field | Rule |
|---|---|
| Name | 1–50 characters after trimming, and unique among active periods ignoring case |
| Start and end times | Required, `HH:mm`; the end must be after the start (no overnight periods, and equal is refused) |
| Overlap | Checked only among active timed periods; touching ends are allowed |
| Sort order | 0–9999; empty means last on add and unchanged on edit |

An inactive period isn't checked for name or overlap. The server checks those when it is activated.

| Server answer | What the screen does |
|---|---|
| 400 field map | Each message under its field; `body` and unknown keys go at the top |
| 409 `PERIOD_OVERLAP` | "Overlaps {name} ({start}–{end}). Active periods can touch but not overlap.", under both Start and End |
| 409 `ALL_DAY_PROTECTED` | "{name} is always open: it can't be given times or deactivated, because light meals depend on it." |
| 404 `MEAL_PERIOD_NOT_FOUND` | The dialog closes, the list reloads, and a notice says so |

- **All Day:** the dialog shows only name and sort order, and never sends times.

**Warnings before a save.** They are shown in the dialog, and need a second click on **Save anyway**.
- **Time change while the period is being sold:** "Lunch is being sold now. Changing its times takes effect immediately:
  items will stop selling at {new end}." If the new times have already passed, it ends "…as soon as you save". This
  warning is shown in red. "Now" is the site's time of day (Africa/Johannesburg) by the server's clock (`serverNow`),
  not the device clock.
- **Any other time change:** says it takes effect immediately.
- **Rename:** "Past reports and the dashboard will show the new name: sales made under {old} will be listed as {new}."
- **Sort order change alone:** no warning.

**Deactivate and activate** (`POST …/deactivate`, `…/activate`). A confirm explains the effect first:
- **Deactivate:** items leave the menu and can't be sold or planned, offline tills stop at their next update, past
  orders and reports keep the period, and it only works when nothing is planned for today or later.
- **Activate:** the period is sold again at its times, starting now.

Refusals stay in the dialog:

| Refusal | Message |
|---|---|
| `PERIOD_IN_USE` | "{name} can't be deactivated: it has {n} meal options and {n} extras planned from {date}. Move them to another period or remove them on Daily planning first." |
| `PERIOD_OVERLAP` on activate | Names the other period |
| 400 on `name` on activate | Adds "Rename one of them first." |

**Change history** (`GET /admin/meal-periods/history`).
- **Columns:** when (SAST), who (`changedByName`, a snapshot), period (its current name), what was done (Added /
  Changed / Deactivated / Activated), and before and after. Only the fields that changed are listed; Added lists every
  field with no "before".
- **Filter and paging:** filter by period (inactive periods included); page sizes 50/100/200.
- **URL:** the tab, filter, page and size are kept in it (`?tab=history&periodId=…&page=…&size=…`).

**Access.** ADMIN only:
- **Page:** a signed-out user goes to the password sign-in and comes back (`/meal-periods` is on the return-to
  allowlist); any other role goes to their own landing page.
- **Sidebar:** the Admin → Meal periods entry is ADMIN only.
- **Server refusal:** a 403 with an empty body shows "Only an admin can."
- **No re-sign-in:** no meal-period write needs a fresh password sign-in.

## Period names elsewhere (tasks 4 and 5)

Every screen already took its periods from `GET /meal-periods`. These places changed:

| Place | Before | Now |
|---|---|---|
| POS menu, `order-builder.tsx` `loadMenuForPeriod` | `/menu/today?period=${name.toUpperCase()}` | `?period=${encodeURIComponent(name)}`; the "same period" check compares the name as given |
| Daily plan, `daily-planning/page.tsx` `adminPlanPath` | `?period=${name.toUpperCase()}` | `?period=${encodeURIComponent(name)}` |
| Ingredient requirements, `daily-planning/page.tsx` | `?period=${name.toUpperCase()}` | `?period=${encodeURIComponent(name)}` |
| Confirm ingredient requirements body | `period: name.toUpperCase()` | `period: name` |
| Daily planning note | "All Day meals and beverages are always available" | "Light meals ({name of the period with `plannable: false`}) and beverages…" |
| Dashboard sales mix colours, `sections-charts.tsx` | Fixed colours for `BREAKFAST` and `LUNCH` keys | Fixed only for light meals and beverages; other groups get palette colours in key order (distinct in a chart, never tied to a name) |
| Comments in `catalog.ts`, `catalog/page.tsx`, `daily-planning/page.tsx` | Named periods as examples | Reworded |

The server matches names ignoring case, so upper-casing worked. It is gone so that nothing builds a code from a name.

**Daily planning also:**
- **`MEAL_PERIOD_INACTIVE` (400)** on add meal option, add component stock and edit: "{name} has been deactivated, so
  nothing can be planned under it. Choose another period." The periods are then reloaded.
- **"Unknown meal period: X" (400 with no code)** on loading the plan or the requirements, or on confirming: the
  server's message shows and the periods are reloaded once. This is the one branch on a status without a code,
  because the contract gives this error no code.
- **Reloading the periods** keeps the selected period by id. It keeps the same object when nothing about the period
  changed, so a reload never starts a loop.

**The search, kept as a test** (`src/lib/no-hard-coded-meal-periods.test.ts`). It scans every `.ts`/`.tsx` file under
`src/` except tests and fixtures, and fails on:
- `Breakfast|Lunch|Dinner|Supper` (any case) anywhere, comments included;
- `All Day` or `ALL_DAY` outside comments (the `allDay` flag and the contract code `ALL_DAY_PROTECTED` are fine);
- `period….toUpperCase()`, or `?period=${…}` without `encodeURIComponent`.

Checked against `main`: it catches all the old places above. Not covered by the scan:
`src/metadatafiles/phase1-frontend-detailed.md`, an old spec that names Breakfast and Lunch. It isn't code.

## Tests

| File | What it covers |
|---|---|
| `src/lib/meal-periods.test.ts` | Field rules, overlap (touching allowed, inactive ignored), All Day, body, warnings (live, shortening, rename, sort order), refusals by code, history changes, calls |
| `src/app/meal-periods/page.test.tsx` | List order, inactive greyed, All Day protected, add, edit, client and server field errors, overlap, warnings, deactivate refused and allowed, activate refusals, 404, tabs, non-ADMIN, 403 |
| `src/components/meal-periods/meal-periods-history.test.tsx` | Rows, before/after, filter, paging, URL |
| `src/app/daily-planning/page.meal-periods.test.tsx` | Renamed periods sent as given, the always-open note, `MEAL_PERIOD_INACTIVE`, the reload keeping the selection, no reload loop |
| `src/lib/no-hard-coded-meal-periods.test.ts` | No period names or codes in the source |
| `src/components/app-sidebar.meal-periods.test.tsx`, `src/lib/return-to.test.ts` | Sidebar entry ADMIN only; the return-to allowlist |

## Not done

- No run against the real T0-5a backend, and no Playwright test.
- **Locations** ("Main Store", "Kitchen" by name, for example "Stock was deducted from Kitchen" on Daily planning): T0-5d.
- **Option 2** (send `periodId`, branch on `UNKNOWN_MEAL_PERIOD`) is not built; the contract takes names.
