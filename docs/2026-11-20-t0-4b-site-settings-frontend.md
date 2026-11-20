# Site settings screen (T0-4b)

Admin → **Site settings** (`/site-settings`, ADMIN only). Lets an admin change the customer's own settings without a
redeploy, and shows who changed what. Built against
[the site settings API contract](2026-11-19-t0-4-site-settings-api-contract.md) (a copy; the backend copy is the source of truth).

## Where things are

| File | What |
|---|---|
| `src/lib/site-settings.ts` | API calls, types, frontend copy (labels, units, group headings, effects notes), value text ↔ API values, edits, the re-sign-in draft |
| `src/app/site-settings/page.tsx` | Page: ADMIN guard, Settings / Change history tabs, leave warning |
| `src/components/site-settings/settings-editor.tsx` | The form: load, edit, Save, Reset, errors, re-sign-in |
| `src/components/site-settings/settings-group.tsx`, `setting-row.tsx`, `setting-input.tsx` | One group, one setting, one input by type |
| `src/components/site-settings/reset-confirm-dialog.tsx` | The confirm before a reset |
| `src/components/site-settings/settings-history.tsx` | Change history |
| `src/hooks/use-unsaved-changes-guard.ts` | The leave warning |

## Behaviour

**Groups and copy.** Settings appear in the API's groups, in the contract's order (VAT, END_OF_DAY, DASHBOARD,
BOARD, TILLS, SESSIONS, OFFLINE). Each group has a frontend heading and description. The server sends no labels,
units or effects notes, so `SETTING_COPY` holds them, keyed by setting key. The effects text follows contract
section 5. A key or group the frontend doesn't know still shows: it is labelled by its key and placed last.

**Default vs changed.** Comes only from `isDefault`: "Default", or "Changed (default: …)". A value saved equal to the
default still shows "Changed", because only a reset clears the saved value. **Reset** shows only when `isDefault` is false.

**Inputs.**
| Type | Input | Notes |
|---|---|---|
| DECIMAL | Text input | Decimal comma accepted; scale and min/max checked on the device |
| INTEGER | Whole number | With "minutes" or "hours" after it |
| BOOLEAN | On/off switch | |
| DATE | Date picker | First trading day has **Clear**; empty is sent as `null` |
| TIME | `HH:mm` time input | |
| TIME_RANGE | Start and end time inputs | Start must be before end |

Values are held as the text typed and converted only when sent.

**VAT as a percentage.** This is display only; the API stays in fractions.
- **Conversion:** the decimal point moves on the string (`shiftDecimal`), never through floating point, so 15.5 % ↔ 0.155 is exact.
- **Limits:** the input accepts 0–99.99 with at most 2 decimals, which is the API's 4 decimals on the fraction.
- **Errors:** the server's 400 message is in fraction terms, so any 400 message for this key is replaced by the
  screen's own wording (`clientMessage`). This should never happen, because the client checks first.
- **Elsewhere:** defaults and history values show as percentages too.

**Save.** Sends one `PUT /admin/settings` with only the settings whose value would change. Text typed back to the
saved value isn't sent. Save is disabled while any value is invalid.
| Result | What the screen does |
|---|---|
| 200 | The response becomes the new state |
| 400 field map | Each message under its setting; a cross-field rule shows a message under both settings. Nothing is saved and the edits stay. |
| 400 for a key that isn't on screen, or `body` | Listed at the top of the form |
| 403 with an empty body | "You don't have permission…" |

**Reset.** `POST /admin/settings/{key}/reset` runs straight away after a confirm, not on Save.
- **Success:** the response (the full list) becomes the new state. Other unsaved edits are kept; any edit to the setting being reset is dropped.
- **400:** shown under both named settings ("wasn't reset; nothing was changed").
- **404 `UNKNOWN_SETTING`:** says so and reloads the list.

**Sensitive settings and REAUTH_REQUIRED** (from Save or Reset).
- **Draft:** sessionStorage `pos.siteSettingsDraft` holds the edits (keys and typed text), the reset asked for, the
  value and `lastChange.at` of each touched setting as first loaded, and `details.keys`. It never holds a password or token.
- **Sign-in:** the page goes to `/login?reauth=1&returnTo=/site-settings` with no leave warning.
- **Back on the page:**
  1. The page reloads the settings, puts the edits back, highlights the settings named in `details.keys`, and clears the draft.
  2. If a reset was pending, its confirm opens again ("You're signed in again. Confirm the reset you asked for.").
  3. Edits to settings that no longer exist are dropped, with a notice.
- **Saves made meanwhile:** there is no version or ETag, so the last save wins. If an edited setting's value or
  `lastChange.at` changed during the sign-in, a notice names it ("Someone else changed … (now …)"). Save then asks
  once ("Replace a newer change?") before sending.
- Nothing is sent again automatically.

**Offline without the entitlement** (`offlineEntitled: false`). The Offline group is greyed, with a note mapped from
`OFFLINE_NOT_ENTITLED`. The settings stay editable and are saved like any other; they apply once offline is switched on.

**Change history** (`GET /admin/settings/history`).
- **Columns:** when (SAST), who (`changedByName`, a snapshot), setting, "Changed" / "Reset to default", and the old and new values.
- **Values:** formatted by the setting's type, with "(default)" added when `oldIsDefault` / `newIsDefault` is true.
- **Filter and paging:** filter by one setting; page sizes 50/100/200. The tab, filter, page and size are kept in the URL (`?tab=history&key=…&page=…&size=…`).
- **Tabs:** the settings form stays mounted while the history is shown, so edits survive switching tabs.

**Leave warning.** Only while there are unsaved or invalid edits:
- `beforeunload` covers reloads, closing the tab and typing another address.
- In-app links (sidebar, breadcrumbs) are caught in a capture-phase click listener and confirmed ("Leave without saving?").

Not covered: the browser's Back/Forward buttons, and navigation started in code, such as the Sign out button.
The App Router has no event to cancel those.

**Access.** ADMIN only:
- **Page:** a signed-out user goes to the password sign-in and comes back; any other role goes to their own landing page.
- **Sidebar:** the Admin → Site settings entry is ADMIN only.
- **Re-sign-in:** `/site-settings` is on the re-sign-in return-to allowlist.

## Tests

| File | What it covers |
|---|---|
| `src/lib/site-settings.test.ts` | Exact VAT conversion, limits, every type, grouping, edits, the draft (no secrets), spotting saves made meanwhile, API calls and errors by code |
| `src/app/site-settings/page.test.tsx` | Groups and effects notes; default vs changed; reset (keeps other edits; 400 on both fields; 404); save sends only the changes; 400s under fields and at the top; offline greyed but saved; tabs; leave warning; non-ADMIN |
| `src/app/site-settings/reauth.test.tsx` | REAUTH_REQUIRED from Save and Reset: edits and the pending reset come back; highlighted settings; the warning about a newer save |
| `src/components/site-settings/settings-history.test.tsx` | Rows and formatting, filter, paging, URL |
| `src/hooks/use-unsaved-changes-guard.test.tsx` | The leave warning on its own |
| `src/components/app-sidebar.site-settings.test.tsx`, `src/lib/return-to.test.ts` | Sidebar entry ADMIN only; the return-to allowlist |
