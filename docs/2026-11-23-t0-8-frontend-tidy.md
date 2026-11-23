# T0-8: frontend tidy-up before T1

Small fixes and one no-behaviour-change refactor, so T1 (multi-tenancy) starts from a clean frontend. Based on the
frontend multi-tenancy readiness analysis (22 Nov 2026, commit `2f06c07`). Branding and locale stay South African
and "Beacon Culinary"; they are gathered into one place each so T1 can switch them to API values.

**Branch:** `feature/infustructureUpdatesFE`, as the project owner decided (main, `244f8ab`, does not yet contain
T0-4b to T0-6b). Commits `bef1b37` (part 1) to `c5f5122` (part 5), then this doc.

| Part | Commit | Visible change for staff |
|---|---|---|
| 1. Daily Planning with no meal periods | `bef1b37` | Yes: a message instead of "Loading periods…" for ever |
| 2. Template pages removed | `edb513f` | Yes: the template pages and "/" are gone; "/" redirects |
| 3. Brand in one place | `7d14243` | Only the login image's alt text and the tab icon |
| 4a. Locale snapshots recorded | `882b055` | None (tests only) |
| 4b. Locale in one place | `550fdd4` | None (proved by the 4a snapshots) |
| 5. Kitchen "kept here for" text | `c5f5122` | None |

## Part 1: Daily Planning with no meal periods

`src/app/daily-planning/page.tsx` now tells three states apart (`periodsStatus`):

| State | Shown |
|---|---|
| Loading (first load) | "Loading periods…" (as before) |
| Loaded, no periods at all | "No meal periods are set up yet." |
| Loaded, only unplannable periods | "Only {names} is set up. Add a meal period for set meals to plan them." ("{A} and {B} are set up" for two or more) |
| Failed first load | "Couldn't load meal periods." with **Try again** |

Under the empty messages: ADMIN gets "Set them up in Admin → Meal periods" (a link to `/meal-periods`); everyone else
(the page is ADMIN and Head Chef only) gets "Ask a manager to set up meal periods." A failed *reload* keeps the tabs
already shown, as before.

The wording names no meal type ("such as Lunch" was suggested): the T0-5b guard test
(`src/lib/no-hard-coded-meal-periods.test.ts`) forbids meal-type names in `src/`, comments included. The period
names shown come from the API.

## Part 2: Template pages removed

"/" now redirects: signed in, to the landing page sign-in uses (`landingPathFor`); signed out, to `/login`. The
create-next-app page (with images from nextjs.org and links to vercel.com) is gone. `/users` still redirects to
`/staff`.

Deleted (each search for other importers came back empty, before and after deleting, in `src/`, `e2e/`, `scripts/`
and the config files; the dashboard sections use `recharts` directly and the report date parameters use a native
`<input type="date">`):

| Deleted | Why |
|---|---|
| `src/app/roles/page.tsx`, `customer-engagements/page.tsx`, `order-management/page.tsx`, `view-orders/page.tsx`, `order-creation/page.tsx` | Template pages, not linked, no sign-in guard |
| `src/components/engagements/engaments-table.tsx`, `customer-chat.tsx` | Demo people; used only by `/customer-engagements` |
| `src/components/orders/order-management.tsx` | Demo chart data; only `/order-management` |
| `src/components/orders/order-tracking.tsx`, `order-tracking-map-view.tsx`, `order-progress.tsx` | OpenStreetMap tiles; only `/order-management` |
| `src/components/customer-orders/order-viewing.tsx`, `order-progress.tsx` | Only `/view-orders` |
| `src/components/date-picker-with-range.tsx`, `src/components/ui/calendar.tsx`, `src/components/ui/chart.tsx` | Only the deleted components |
| `src/components/customer-orders/order-creation.tsx`, `src/hooks/use-order.ts`, `src/contexts/order-context.tsx` | Already unused |
| `src/components/customer-orders/order-payments.tsx`, `src/components/icons.tsx` | Already unused |
| `src/components/nav-projects.tsx`, `search-form.tsx`, `version-switcher.tsx` | Already unused |
| npm: `leaflet`, `react-leaflet`, `react-day-picker` | Nothing imports them any more |

Kept because still used: `src/components/orders/status-visuals.ts` (kitchen, bar, board),
`src/components/orders/offline-order-marks.tsx` (POS, sale exceptions, reprint), `recharts` (dashboard),
`@radix-ui/react-separator` (`ui/separator`).

Side effect: leaflet's images left the service worker's precache list.

## Part 3: The brand module

`src/lib/brand.ts` holds today's values:

| Value | Used by |
|---|---|
| `name` "Beacon Culinary" | `src/app/layout.tsx` (title), `app-sidebar.tsx` (team), `nav-main.tsx` (group label) |
| `description` "Canteen POS system" | `layout.tsx` |
| `planLabel` "Canteen" | `app-sidebar.tsx` |
| `loginHeading` "Login to your Beacon Culinary Account" | `login-form.tsx` |
| `loginImage` (static import of `beacon_login_image.png`), `loginImageAlt` "Beacon Culinary" | `login-form.tsx` (the alt text was "Image") |

Favicon: the create-next-app `src/app/favicon.ico` is replaced by `src/app/icon.svg`, the Lucide **"utensils"** icon
(lucide-react v0.471.0, **ISC License**, already a dependency), in a neutral slate stroke. Next serves it and adds
the `<link rel="icon">` tag.

`src/lib/no-hard-coded-brand.test.ts` fails if "Beacon Culinary" appears in `src/` outside `brand.ts` (tests
excluded).

**How T1 feeds it:** a branding response for the customer's address (for example `GET /public/branding` →
`{ name, shortName, logoUrl, faviconUrl, planName }`) replaces the constant with a hook or provider; the five call
sites read the same fields. The page title is set by `metadata` on the server, so it needs either `generateMetadata`
reading the host, or setting `document.title` once branding loads.

## Part 4: The locale module

`src/lib/locale.ts` holds `TIME_ZONE` ("Africa/Johannesburg"), `LOCALE_ZA` ("en-ZA"), `LOCALE_GB` ("en-GB"),
`CURRENCY` ("ZAR") and `CURRENCY_SYMBOL` ("R"). Both locale tags are kept as they were used; formats are not unified.

Replaced with the module's values: the four time-zone constants (`dashboard.ts`, `offline/server-time.ts`,
`pos-activity.ts`, `receipt.ts`; `DASHBOARD_TIME_ZONE` and `TRADING_TIME_ZONE` keep their names), the Intl locale
tags (`utils.ts`, `amount-input.ts`, `reports.ts`, `pos-activity.ts`, `dashboard.ts`, `meal-periods.ts`,
`receipt.ts`, the kitchen and bar boards, `offline-status-card.tsx`), the `ZAR` codes (`utils.ts`,
`amount-input.ts`) and the literal "R" prefixes (`inventory/page.tsx`, `sale-exceptions/page.tsx`, `dashboard.ts`
×2, `offline/offline-sale.ts`, `receipt.ts` VAT line template, `catalog/page.tsx` price label). The offline trading
day (`server-time.ts`) only takes its zone from the module; its logic is unchanged.

One `moneyOrDash`: the copy in `src/components/inventory/grv-vat-controls.tsx` was identical to `src/lib/money.ts`
(both "—" for null or undefined, otherwise `formatZarCurrency`) and was removed; the inventory page imports
`@/lib/money`.

**Proof of no visible change:** `src/lib/locale-output.snapshot.test.ts` recorded the output of every touched
money, number, date, time and receipt formatter in its own commit (`882b055`) before the refactor. After the
refactor the same snapshots pass and `src/lib/__snapshots__/locale-output.snapshot.test.ts.snap` is unchanged. The
receipt-printing tests ("Incl. VAT 15%: R 7.83") pass unchanged too.

`src/lib/no-hard-coded-locale.test.ts` fails if `Africa/Johannesburg`, a `ZAR` string or a literal "R" money prefix
appears in `src/` outside `locale.ts` (comments, tests and fixtures excluded).

**How T1 feeds it:** the site locale from the API (`{ timeZone, currency, locale }`, in branding or site settings)
replaces the constants; the formatters are module-level `Intl` objects today, so they become functions of the locale
(or are rebuilt when it loads). Reports should then format with their own `meta.currency` and `meta.timezone`
(`src/lib/reports.ts`, `ReportEnvelope.meta`), which nothing reads yet.

## Part 5: Kitchen "kept here for" text

"Done orders are kept here for 10 minutes." on the kitchen display now comes from `doneRetentionNotice()` in
`src/components/orders/status-visuals.ts`, built from `DONE_RETENTION_MS`: the same value the kitchen uses to drop
done orders (`kitchen-queue-board.tsx`, three places). No change for staff. It does not read
`board.done-display-minutes`, which is the public board's setting.

### Backend request

> **Kitchen done-order retention as a site setting.** Add a site setting for how long done orders stay on the
> kitchen display (for example `kitchen.done-display-minutes`, default 10 minutes, a sensible range such as 1–120),
> readable by KITCHEN and HEAD_CHEF (for example in `GET /kitchen/orders`, or a small kitchen settings endpoint;
> `/admin/site-settings` is ADMIN only). The frontend will use it for both the behaviour (dropping done orders) and
> the text, falling back to 10 minutes until it is loaded.

### Other hard-coded numbers checked

None duplicates a site setting (`src/lib/site-settings.ts`). Candidates if the backend ever makes them settings:

- "Enter admin PIN to unlock management mode for 5 minutes." (`src/app/pos/page.tsx`): the POS management-mode window.
- "The till's clock was more than 5 minutes out." (`src/lib/sale-exceptions.ts`): a backend threshold.

`DEFAULT_IDLE_LOCK_MINUTES` (`src/lib/till.ts`) is only a fallback until `pos.session.idle-lock-minutes` loads.

## Checks

- Vitest: 142 files, 1,175 tests pass. tsc and lint clean. `npm run build` clean (the deleted routes are absent
  from `.next/server/app-paths-manifest.json`, so they get the app's 404).
- Playwright e2e: 2 tests pass (offline reload; offline selling, reload, lock and sync).

## Follow-ups

- Backend: the kitchen retention setting above.
- T1: branding and site-locale endpoints feeding `brand.ts` and `locale.ts`; reports formatted with `meta.currency`
  and `meta.timezone`.
- Storage keys `bar-talk.*` and the IndexedDB name `beacon-pos-offline` still carry old names (analysis C8); rename
  before many tills exist (the offline database needs a migration).
- The legacy `src/metadatafiles/phase1-frontend-detailed.md` still names meal types; it is documentation, not code.

## Files

Created:
- `docs/2026-11-23-t0-8-frontend-tidy.md`
- `src/lib/brand.ts`, `src/lib/locale.ts`, `src/app/icon.svg`
- Tests: `src/app/daily-planning/page.periods.test.tsx`, `src/app/page.test.tsx`,
  `src/lib/no-template-pages.test.ts`, `src/lib/brand.test.tsx`, `src/components/login-form.brand.test.tsx`,
  `src/lib/no-hard-coded-brand.test.ts`, `src/lib/locale-output.snapshot.test.ts` (with
  `src/lib/__snapshots__/locale-output.snapshot.test.ts.snap`), `src/lib/no-hard-coded-locale.test.ts`,
  `src/components/orders/status-visuals.test.ts`, `src/components/kitchen/kitchen-queue-board.retention.test.tsx`

Modified:
- `package.json`, `package-lock.json`
- `src/app/page.tsx` (replaced), `src/app/layout.tsx`, `src/app/daily-planning/page.tsx`, `src/app/inventory/page.tsx`,
  `src/app/sale-exceptions/page.tsx`, `src/app/catalog/page.tsx`
- `src/components/app-sidebar.tsx`, `src/components/nav-main.tsx`, `src/components/login-form.tsx`,
  `src/components/kitchen/kitchen-queue-board.tsx`, `src/components/bar/bar-queue-board.tsx`,
  `src/components/devices/offline-status-card.tsx`, `src/components/inventory/grv-vat-controls.tsx`,
  `src/components/orders/status-visuals.ts`
- `src/lib/utils.ts`, `src/lib/amount-input.ts`, `src/lib/dashboard.ts`, `src/lib/pos-activity.ts`,
  `src/lib/receipt.ts`, `src/lib/reports.ts`, `src/lib/meal-periods.ts`, `src/lib/offline/offline-sale.ts`,
  `src/lib/offline/server-time.ts`

Deleted: the 24 files listed under part 2, and `src/app/favicon.ico`.
