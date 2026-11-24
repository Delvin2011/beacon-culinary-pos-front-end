# O3 offline foundation (frontend)

**Branch:** `feature/o3-offline-foundation-frontend`, from `main` at `a91cb8d` (O1, O2 and O2b merged).
**Contract:** `docs/2026-11-17-o3-offline-foundation-api-contract.md` (POS_BE, `feature/o3-offline-foundation`). It isn't in
this repo; code comments name its sections.

O3 makes the POS **ready** to sell through an outage:

- it loads without the internet;
- it keeps the cashier on the till;
- it holds today's menu and a signed permission to sell offline.

**Selling offline is O4.** In O3, Confirm still waits for the connection, as in O1. Everything is behind the server's
`offlineEnabled` flag (`GET /pos/till-status`). With the flag off the till behaves as before, apart from the status
heartbeat and the service worker, which caches only the app shell.

## What the till stores

Everything below is in IndexedDB, database `beacon-pos-offline` (version 1), in this browser only.

| Store | What it holds | Written when |
|---|---|---|
| `grant` | The `POST /pos/offline/grant` response exactly as received; the `grant` string is opaque and never parsed | After shift open, after each online sign-in or resume by the shift owner, and when less than `maxOfflineHours` is left before `expiresAt` |
| `snapshot` | `GET /pos/offline/snapshot` with its ETag | At sign-in, at shift open, every 5 minutes online and on reconnect, with `If-None-Match` (a 304 keeps it) |
| `unlockVerifier` | `{userId, shiftId, salt, iterations, hash, createdAt}`: a PBKDF2 check value, **never the PIN** | After an online PIN sign-in on a registered till with offline on |
| `offlineSeq` | `{nextOfflineSeq, tradingDay, shiftId}`, the larger of the stored and the grant's number for the same day | With each grant (used by O4) |
| `meta` | `tillStatus` (the last answer), `lastShift`, `serverTimeOffsetMs`, `offlineSince`, `lastSnapshotAt`, `lastStatusAt`, `clockSkewMs`, `heartbeatStopped`, `unlockFailures`, `unlockIterations`, `persistResult` | As they happen |
| `outbox`, `accountLedger` | Reserved for O4; empty | Never in O3 |

Some details on these stores:

- **Snapshot rules:**
  - It counts only for today: its `tradingDay` must equal today in Africa/Johannesburg, **by server time**.
  - A failed refresh never clears it.
  - Fetched while the till has no open shift, it's stored without its accounts list and without an ETag. The first refresh after a shift opens then gets the full body.
  - The ETag is read from the header, or rebuilt as the quoted `snapshotVersion` when CORS doesn't expose the header. The fallback stays.
- **Server time:** taken from the latest `serverTimeUtc` in `/health`, the grant, the snapshot or the status reply. It decides "today" and grant expiry.
- **Persistent storage:** requested with `navigator.storage.persist()`, with the result shown on the devices page.
- **When storage isn't available** (no IndexedDB, blocked site data, or no answer within 3 s), the till isn't ready for offline and works online as before.

Outside IndexedDB, unchanged from O1 and O2: the access token and user (`localStorage`, `bar-talk.auth`), the pending sale (`localStorage`), the print switches (`localStorage`) and the service worker's cache (below).

## When it's deleted

The rules run on a fresh `GET /pos/till-status` answer, never while offline:

| Seen | Deleted |
|---|---|
| `registered: false` (the till was revoked), with anything stored | Everything except the O4 outbox (empty in O3; what happens to unsynced sales on revoke is O4's decision) |
| `offlineEnabled: false` | The grant and the unlock value (the snapshot stays: no secrets) |
| No shift, or a shift other than the grant's (a close, a force close, another cashier's shift) | The grant, the unlock value and the snapshot's accounts list |
| An unlock value for another shift, while the grant is fine | Only the unlock value |
| Grant refused with `NO_OPEN_SHIFT`, `DEVICE_NOT_REGISTERED` or `OFFLINE_DISABLED` | The grant and the unlock value |
| Sign-out (not a lock) | The snapshot's accounts list (contract §11) |

`NOT_SHIFT_OWNER` (for example an admin covering) deletes nothing: the till is quietly not ready until the owner signs in. A session ended by the server (`SESSION_ENDED`, including `IDLE` after an outage) deletes nothing either. The grant outlives the session by design (decision G).

## Ready for offline

The till is ready only when **all** of these hold:

1. `offlineEnabled` is true.
2. The till is registered.
3. It has an open shift, owned by the signed-in cashier (and the server didn't say `NOT_SHIFT_OWNER`).
4. The grant is valid: its `shiftId` is the till's open shift, its `cashierId` is the signed-in user and the shift's owner, and `expiresAt` hasn't passed by server time. `deviceId` isn't checked (the till can't know its own).
5. The snapshot is today's.
6. Storage is available.
7. Once offline, the till has been offline for less than `maxOfflineHours`.

What the cashier sees:

- **Online and ready:** an **"Offline ready"** chip beside the connection badge.
- **Offline and ready:** a banner, **"Offline mode · 1 h 05 min"**, which turns amber from `warnOfflineHours`.
- **Offline and not ready:** **"Offline. This till can't sell offline: {reason}"**, giving the first rule above that fails.
- **With `offlineEnabled` false:** none of these.

## Staying on the till offline

- **A reload with no connection lands on the POS.**
  - The cashier is restored from storage with no server call.
  - The shift is restored from the last one loaded online. That needs a valid grant for it, the signed-in user as its owner, and offline on and the till registered (saved till-status).
  - O1's amber line says it's showing the last known shift.
- **The menu comes from today's snapshot** when the live menu can't load. It's read-only in O3: the tiles are disabled, with "Offline copy of today's menu from 09:15. Read-only until the connection is back."
- **Server-only views:** Today's Orders says "Not available offline", and Reading and End shift are disabled.
- **Back online after a long outage:** the server has usually ended the idle session (`SESSION_ENDED`, `IDLE`), and the till shows the sign-in screen. The owner signs back in, which resumes the shift. The grant is kept.

## Locking and unlocking offline (D13)

**The check value:**

- It's made at an online PIN sign-in on a registered till with offline on, using WebCrypto PBKDF2-SHA256 with a random 16-byte salt and 256 bits.
- Not for someone signing in on another person's shift.
- Made before the shift opens, it has no shift, and it's bound to the shift when its owner opens it.
- The PIN is never stored, logged or sent, and the check value never leaves the till.

**Iterations** are measured once per till, aiming for **about 0.4 s per check**, between 300,000 and 3,000,000 (`meta.unlockIterations`, shown on the devices page). Measured on the development PC: 100,000 iterations in 37 ms, so about **1,080,000** iterations there (1,000,000 took 366 to 389 ms). A slower till uses fewer, but at least 300,000.

**The sign-in screen offline:**

- Only the shift owner's tile is shown, from the grant: "Offline: only {owner} can unlock this till."
- The right PIN starts a **local offline session**. It has no token and is never saved, so a reload asks again.
- A wrong PIN shows "Incorrect PIN. {n} tries left."
- After **5** wrong tries: "Offline unlock is disabled until the till is back online." This survives a reload, and the count resets at the first till-status read online.
- **Back online,** the offline session ends (the cart is kept) with "Back online. Sign in again."

**Lock till offline** works as in O2: it locks at once, and the `POST /pos/lock` is sent again when the connection returns.

## Status heartbeat

`POST /pos/offline/status` is sent with the till cookie only (no bearer token):

- when the POS opens, every 60 s while online, and immediately on reconnect;
- on every POS screen, signed in or not, whatever `offlineEnabled` says.

**The body** is `{pendingCount: 0, pending: [], tillClockUtc, offlineSince?, appVersion}`. `appVersion` is the build ID (for example `0.1.0-7e4e8aa-mwlwigt8`), and `lastSyncAt` comes in O4.

**`offlineSince`** is recorded (by server time) when the till goes offline, sent with the first report after reconnecting, and cleared once that report succeeds.

**The reply** gives the time offset and `clockSkewMs`. The devices page shows the clock difference and warns past ±2 minutes.

**`DEVICE_NOT_REGISTERED`** stops the heartbeat, across reloads, until this browser registers again or till-status says it's registered.

## Service worker

`npm run build` runs `next build`, then `scripts/build-sw.mjs`, which writes `public/sw.js` (git-ignored).

- **Versioning:** the version is the build ID; `next.config.mjs` makes `.next/BUILD_ID` and the client's `NEXT_PUBLIC_APP_VERSION` the same value.
- **What's precached:** only what the POS routes need. That's `/pos`, `/pos/login` and `/pos/shift-open` (HTML and route data), the files `.next/app-build-manifest.json` lists for them (exact keys, so not `/pos-activity`), and `static/media` (fonts, sign-in image). That's 28 files for the current build.
- **Serving:** POS pages and route data go to the network first (4 s), with the cache as fallback. Precached files come from the cache first.
- **Never cached:** API responses (another origin, including `/health`, `/pos/till-status` and every `/pos/offline/*`), back-office routes and non-`GET` requests. Nothing is added at run time.
- **Registration:** from the POS layout, in production builds only.
- **Updates:**
  - A new version waits.
  - It activates only on `/pos/login`, with no sale pending and (O4) the outbox empty.
  - The sign-in screen reloads once onto it.
  - Older builds' caches are deleted.

**Azure headers**, measured on 18 Nov 2026:

| Resource | `Cache-Control` |
|---|---|
| `/pos`, `/pos/login` (HTML) | `s-maxage=31536000, stale-while-revalidate` with an ETag (no browser max-age, so browsers revalidate) |
| `/_next/static/*` | `public, max-age=31536000, immutable` (file names change per build) |
| `public/` files, and so `/sw.js` | `public, max-age=0` (checked on the standalone server; `deploy.ps1` now prints it after each deploy) |

## How to check a till is ready for offline

1. **Turn offline on** on the server (`POS_OFFLINE_ENABLED=true`, with a grant signing key).
2. **Set up the till.** It should be registered and in the kiosk shortcut, as in `docs/2026-11-17-till-printing-setup.md`, with a normal browser profile, never InPrivate.
3. **Sign in.** The shift owner signs in with their **PIN** (opening the shift if needed) and waits about a minute. The POS header should show **"Offline ready"**.
4. **Check the devices page** (admin, **Registered tills**, **Offline on this till**):
   - Storage: "Available · Persistent";
   - Status reports: a recent time;
   - Clock difference: no warning;
   - Offline permission: the open shift;
   - Today's menu: today;
   - Offline unlock: "Set up for {owner}".
5. **Run a test outage:**
   1. Unplug the network.
   2. Within about a minute the banner shows "Offline mode".
   3. Reload with F5: the POS stays, showing the offline copy of the menu.
   4. Lock the till, and unlock with the owner's PIN.
   5. Plug the network back in, and sign in again when asked.
6. **Check the manager's view:** the Tills view (**POS Activity**) should show the till as **OK** with a recent report time.

## Tests

- **Vitest** (`npm test`): 606 tests at step 9. They cover:
  - the contract parsers, server time and the storage layer;
  - the heartbeat;
  - snapshot and grant sync, and every deletion rule;
  - readiness, one test per rule;
  - the offline shift and menu, and Today's Orders;
  - `SESSION_ENDED` (`IDLE`) keeping the grant;
  - the offline unlock (right PIN, 5 wrong tries, other cashiers, the PIN never stored);
  - the generated service worker run in a fake service-worker scope;
  - the devices card, the Tills view column, and the shift close and Close Day refusals.
- **Playwright** (`npm run test:e2e`; builds first, about 2 minutes, then serves the standalone build on port 3200): `e2e/offline-reload.spec.ts` covers:
  1. signing in online;
  2. "Offline ready";
  3. the worker controlling the page;
  4. the cache holding only the POS shell;
  5. offline and reload: the POS with the cashier, the restored shift and the read-only snapshot menu, with no redirect;
  6. back online: the live menu.

  The API is mocked at `http://127.0.0.1:8099`. The e2e build sets `NEXT_PUBLIC_AUTH_API_URL` to that address, overriding `.env.local`, and leaves that build in `.next`. **Run `npm run build` again before deploying.** (Superseded by T1-0d: the e2e build has no API address; see docs/2026-11-24-relative-api.md.)

## Risks

- **The PIN check value can be brute-forced.** A 6-digit PIN's check value can be cracked by anyone who can read the till's storage. Its limits are its lifetime (one shift; deleted with the grant) and, in O4, flagging sales made after an offline unlock.
- **An unsent lock is lost on reload.** A lock made offline is resent from memory when the connection returns (O2). After a reload before that, the server ends the session itself after 30 idle minutes.
- **The browser can evict storage.** If `persist()` is refused, the browser can clear offline data under storage pressure. The till then works online and says it isn't ready.
- **The offline indicator turns slowly.** After a reload with no connection, it takes a few failed pings, possibly a minute. The sign-in screen doesn't wait: a cashier list with no answer counts as offline.
- **A deployment during an outage** keeps the till on its old version until it's back on the sign-in screen online. That's intended: the new version activates only there.
- **The snapshot has no categories**, so the read-only offline menu groups always-on items under "Other".

## Left for O4

- Selling offline:
  - the outbox, offline numbering from `offlineSeq`, and account sales up to `accountCap`;
  - sync, and `pendingCount`/`pending[]`/`lastSyncAt` in the heartbeat;
  - flagging sales made after an offline unlock.
- Update activation waiting for an empty outbox (the stub in `lib/offline/sw-register.ts`).
- The Close Day override for `OFFLINE_SALES_PENDING`. O3 only shows the blocker's message and links to the Tills view.
