# The API on the page's own address (T1-0d)

> **Warning: never deploy this to the current Azure App Service.** Since T1-0d the app calls `/api` on its own
> address, and only Azure Front Door sends `/api/*` to the backend. The App Service has no `/api` route: every API
> call there would answer 404. Production keeps deploying from `main`; the integration branch
> (`feature/infustructureUpdatesFE`) is never deployed. `deploy.ps1` enforces both: it refuses any branch but `main`,
> and refuses a build that calls `/api` unless `-BehindFrontDoor` is passed.

Every API call goes to `/api` + the backend path on the address the page was loaded from, so **one build serves every
customer address** (`<customer>.pos.optimumscs.com`). Nothing about the backend's address is built in.

## 1. How the app reaches the API

| Where | Browser calls | What sends it to the backend |
|---|---|---|
| Production (later) | `https://<customer>.pos.optimumscs.com/api/...` | Azure Front Door: route `/api/*` to the backend, forwarding path `/` (the prefix removed) |
| Local stack, container mode | `https://<customer>.pos.localhost/api/...` | Caddy: `handle_path /api/*` → `backend:8080` (the prefix removed). Pages come from the frontend container |
| Local stack, host mode | The same | Caddy, as above; pages come from `npm run dev` on the host (`host.docker.internal:3000`). The dev server never sees `/api` |
| `npm run dev` alone | `http://localhost:3000/api/...` | A development-only rewrite in `next.config.mjs` → `DEV_API_PROXY_TARGET` (section 3) |
| e2e tests | `http://127.0.0.1:3200/api/...` | Nothing: Playwright intercepts `/api/**` in the browser (`e2e/mock-api.ts`) |

**In the code.** `src/lib/api-url.ts` is the one place an API address is made: `apiUrl("/auth/login")` returns
`/api/auth/login`. It throws on a full URL, `//host`, a path without the leading `/`, or a path that already starts
with `/api`. Everything goes through it:

- `authFetch` (auth context): every authenticated call, including the kitchen and bar streams;
- the auth context's own calls: login, PIN login, refresh, logout, lock;
- the POS, kitchen and bar sign-in pages; the public board (`/public/board/today` and its stream);
- the connection check (`/health`), invites (`/auth/invites/*`), till status (`fetchTillStatus()`), the offline
  heartbeat (`sendStatusReport`) and offline sync (`sendBatch`), which no longer take an address.

`NEXT_PUBLIC_AUTH_API_URL` and every `http://localhost:8080` fallback are gone from the app. **Credentials are
unchanged:** `include` where it was (on one origin it sends the same cookies), `omit` for the invite calls and
`/health`.

## 2. Cookies

The backend sets the refresh cookie with `Path=/api/auth/refresh` when its `cookie.path-prefix` is `/api`
(`COOKIE_PATHPREFIX=/api`, T1-L0); the browser then sends it to `/api/auth/refresh` and nowhere else. The stack sets
it; production needs it too (go-live checklist). On one origin, `SameSite` no longer matters for the API.

## 3. `npm run dev` on its own

```powershell
# A backend on localhost:8080 (the default), started with COOKIE_PATHPREFIX=/api:
npm run dev
# Or another backend:
$env:DEV_API_PROXY_TARGET = "http://localhost:9090"; npm run dev
```

`next.config.mjs` is a function of Next's phase. In `PHASE_DEVELOPMENT_SERVER` only, it adds:

- the rewrite `/api/:path*` → `${DEV_API_PROXY_TARGET}/:path*` (default `http://localhost:8080`; a trailing `/` is
  trimmed), removing the prefix as the gateways do;
- `compress: false`. The dev server's gzip held event streams back until they ended: measured with a stand-in backend
  sending one event a second, all events arrived together at the end with gzip, one a second without. The kitchen,
  bar and board streams never end, so they would have shown nothing.

Without `COOKIE_PATHPREFIX=/api` on that backend, the refresh cookie's path is `/auth/refresh`, the browser never
sends it to `/api/auth/refresh`, and staying signed in fails.

**Why the rewrite can't reach production.** Next calls the config function with the phase. `next build` calls it in
`PHASE_PRODUCTION_BUILD`, where no rewrite is defined, whatever `DEV_API_PROXY_TARGET` says. The standalone server
never reads `next.config.mjs` again: it uses the rewrites saved at build time in `.next/routes-manifest.json`, which
are empty. Three checks hold this:

- `src/lib/dev-api-proxy.test.ts`: the build and production-server phases have no rewrite and leave compression alone,
  even with `DEV_API_PROXY_TARGET` set; the development phase has the rewrite and `compress: false`;
- `npm run check:build` on every build the e2e tests and the image make (section 6);
- the build was made with `DEV_API_PROXY_TARGET` set to a made-up address, and that address is nowhere in it.

## 4. The service worker

`/api` is in `NEVER_HANDLED` (`src/sw/routes.mjs`), next to `/invite` and `/auth/invites`: the worker never answers an
API request (navigation, GET, POST or route data, streams included), and the browser handles it as if there were no
worker. Before T1-0d the worker left API calls alone because they went to another origin; on one origin it has to be
a rule. `src/sw/sw-routes.test.ts` checks each API path (`/api`, `/api/pos`, till status, the snapshot, offline sales,
the three streams, invites), that `/apiary` and `/api-docs` aren't caught, and that the generated worker answers and
caches none of them; the e2e tests check that no API response came from the worker.

## 5. The e2e tests

The e2e build is the build production gets: no API address, no rewrite. `e2e/mock-api.ts` intercepts
`http://127.0.0.1:3200/api/**` in the browser, removes `/api` (as Front Door does) and answers per backend path; on
one origin there is no CORS, so the CORS headers and preflight answers are gone. Both specs end by checking the
service worker answered no API call. The Playwright server command is
`npm run build && npm run check:build && node scripts/e2e-serve.mjs`: the tests don't start on a build with a backend
address in it.

**Main paths (`e2e/main-path.spec.ts`, follow-up C3).** Online, against the same mock:

- password sign-in; the refresh cookie arrives scoped to `/api/auth/refresh` (HttpOnly); the access token then
  expires and a reload stays signed in: the 401 leads to one `POST /api/auth/refresh` carrying that cookie, and the
  call is retried with the new token. The sign-in picture comes from `/_next/static/media`, never `/_next/image`;
- PIN sign-in on the registered till and a cash sale: the order request (item, cash, tendered amount), then the
  receipt and the kitchen ticket printed (`window.print` recorded);
- the kitchen display, in its own browser context on the same mocked backend, shows the till's order within 5 s
  through its stream; queue loads are held meanwhile, so only the stream can have brought it.

`e2e/mock-api.ts`: `createBackend()` makes one backend that `mockApi(context, backend)` serves to several contexts;
the mock logs each call's token and status, and can expire an access token (`expiredTokens`).

## 6. Guards

| Guard | Fails when |
|---|---|
| `src/lib/no-backend-address.test.ts` (Vitest) | `src` (tests excluded, comments ignored) reads `NEXT_PUBLIC_AUTH_API_URL`, names `localhost:8080`, writes `/api` outside `api-url.ts` and the service worker's never-handled list, passes a literal or template address to `fetch` / `fetchWithTimeout` / `EventSource`, or names an `http(s)` host |
| `npm run check:build` (`scripts/check-build-no-backend.mjs`) | `.next/routes-manifest.json` has a rewrite; `.next/static`, `.next/server`, the standalone output (without `node_modules`) or `public/sw.js` contains `localhost:8080`, `127.0.0.1:8080`, `127.0.0.1:8099`, `NEXT_PUBLIC_AUTH_API_URL`, `DEV_API_PROXY_TARGET` or that setting's current value; or no client chunk calls `/api`. Warns about `.env` files in the standalone output. Runs before the e2e tests and in the `Dockerfile` |
| `deploy.ps1` | The branch isn't `main` (or git can't tell); or the build calls `/api` (`src/lib/api-url.ts` exists) and `-BehindFrontDoor` wasn't passed |

Each was shown to fail: the source guard on a file with the old line, a template `fetch`, an `/api` string and an
outside host; `check:build` on a planted `localhost:8080` in a client chunk and a planted `/api` rewrite; the
service-worker tests with the old never-handled list; the `deploy.ps1` guards on this branch, as if on `main`, and
outside git (Windows PowerShell 5.1; PowerShell 7 not installed here).

## 7. The container

The `Dockerfile` no longer takes `NEXT_PUBLIC_AUTH_API_URL`: one image for every customer. It keeps
`POS_APP_BUILD_ID` and runs `npm run check:build` after the build (`docs/2026-11-24-frontend-container.md`).

## 8. Cross-origin workarounds (report)

| Workaround | Can it be simplified now? | This slice |
|---|---|---|
| Logout without `keepalive` (a keepalive request needing a CORS preflight could be refused) | Yes: on one origin there is no preflight, so `keepalive: true` lets the logout survive the page closing | Comment updated in T1-0d; **turned on in follow-up C1**, and the logout test expects it |
| Snapshot ETag rebuilt from `snapshotVersion` when the header isn't readable (CORS didn't expose it) | The header is readable on one origin, but keep the fallback: a gateway (Front Door's compression, a cache) may drop or weaken the ETag | Comment updated only. No change planned |

## 9. Backend requests

- **`devstack/compose.yaml`:** drop the frontend service's `args` (`NEXT_PUBLIC_AUTH_API_URL`) and the per-customer
  image tag (`beacon-devstack/frontend:${ACTIVE_CUSTOMER}` → `beacon-devstack/frontend`), so switching customer reuses
  the image. Until then Docker warns that the argument wasn't used; nothing breaks.
- **`docs/2026-11-23-local-stack.md`:** section 3's frontend contract ("takes the build argument") and host mode (no
  `NEXT_PUBLIC_AUTH_API_URL` in `.env.local`; `npm run dev` as it is).
- **Production:** `COOKIE_PATHPREFIX=/api` and Front Door's `/api/*` route with forwarding path `/` (already on the
  go-live list).

## 10. Local-stack checklist (Docker machine, after merge)

In the backend repository, with `FRONTEND_REPO` pointing at this repository and `FRONTEND_MODE` blank or `container`.

1. `.\devstack\scripts\up.ps1` (builds the frontend image). Note the image id: `docker images beacon-devstack/frontend*`.
2. At `https://beaconculinary.pos.localhost/`, with DevTools' Network tab open:
   - [ ] every API call goes to `https://beaconculinary.pos.localhost/api/...`; none shows "(ServiceWorker)" as its source;
   - [ ] password sign-in as the admin works;
   - [ ] Application → Cookies: `refreshToken` has Path `/api/auth/refresh`;
   - [ ] refresh: delete the access token from storage (or wait for it to expire) and reload: still signed in, and
         `POST /api/auth/refresh` answered 200;
   - [ ] `.\devstack\scripts\plan-today.ps1`, then on the till (`/pos/login`): PIN sign-in and a cash sale;
   - [ ] the kitchen display (`/kitchen`) shows the order within 5 seconds (the stream at `/api/kitchen/orders/stream`).
3. `.\devstack\scripts\up.ps1 -Customer testcustomer`. **The same image:** the id from step 1 is unchanged (once the
   compose change in section 9 is made; until then compose rebuilds per customer, from the same code).
4. Step 2 again at `https://testcustomer.pos.localhost/`, signing in as its first admin (the invite link `up.ps1`
   printed, or `reset.ps1 -Customer testcustomer` for a new one); `plan-today.ps1` first.
5. [ ] `https://beaconculinary.pos.localhost/` now answers 503 "not the active customer".
6. [ ] `.\devstack\scripts\smoke.ps1` passes.

## 11. Follow-ups

- The backend requests in section 9.
- Remove `NEXT_PUBLIC_AUTH_API_URL` from your own `.env.local`: nothing reads it (checked: its value is in no build file).

Done on `feature/t1-0d-follow-ups` (section 13): keepalive on logout, `images.unoptimized`, the main-path e2e tests.

## 12. Files

T1-L0-FE (before T1-0d): `Dockerfile`, `.dockerignore`, `.gitattributes`, `docs/2026-11-24-frontend-container.md`.

T1-0d:

| Kind | Files |
|---|---|
| New | `src/lib/api-url.ts`, `src/lib/api-url.test.ts`, `src/lib/no-backend-address.test.ts`, `src/lib/dev-api-proxy.test.ts`, `scripts/check-build-no-backend.mjs`, `docs/2026-11-24-relative-api.md` |
| App code | `src/contexts/auth-context.tsx`, `src/contexts/connection-context.tsx`, `src/contexts/offline-context.tsx`, `src/app/pos/login/page.tsx`, `src/app/kitchen/login/page.tsx`, `src/app/bar/login/page.tsx`, `src/components/board/public-display-board.tsx`, `src/components/pos/offline-heartbeat.tsx`, `src/components/pos/offline-sync.tsx`, `src/hooks/use-auto-lock.ts`, `src/lib/invites.ts`, `src/lib/till.ts`, `src/lib/offline/heartbeat.ts`, `src/lib/offline/sales-sync.ts`, `src/lib/offline/snapshot-sync.ts` (comment), `src/sw/routes.mjs` |
| Tests | `src/sw/sw-routes.test.ts`, `src/lib/till.test.ts`, `src/lib/offline/sales-sync.test.ts`, `src/contexts/auth-context.auth-fetch.test.tsx`, `src/contexts/auth-context.logout.test.tsx`, `src/contexts/auth-context.refresh-resilience.test.tsx`, `src/contexts/auth-context.session-ended.test.tsx`, `src/contexts/offline-context.test.tsx`; the URL stubs (one line each) in `src/app/pos/end-shift-offline-waiting.test.tsx`, `src/app/pos/lock-till.test.tsx`, `src/app/pos/shift-close-offline-pending.test.tsx`, `src/components/devices/receipt-settings-dialog.test.tsx`, `src/components/pos/offline-sync.test.tsx` and eight `src/components/pos/order-builder.*.test.tsx` |
| Config, e2e, deploy | `next.config.mjs`, `package.json` (`check:build`), `playwright.config.ts`, `e2e/mock-api.ts`, `e2e/urls.ts`, `e2e/offline-reload.spec.ts`, `e2e/offline-selling.spec.ts`, `Dockerfile`, `deploy.ps1` |
| Docs | `docs/2026-11-24-frontend-container.md`, `docs/2026-11-18-offline-foundation.md` (superseded note) |

## 13. Follow-ups done (`feature/t1-0d-follow-ups`)

| Step | Change | Files |
|---|---|---|
| C1 | `keepalive: true` on `POST /api/auth/logout` (same origin: no preflight; no body), so signing out still ends the server session if the page closes straight after; the 2 s timeout stays | `src/contexts/auth-context.tsx`, `src/contexts/auth-context.logout.test.tsx` |
| C2 | `images: { unoptimized: true }` in every phase (`docs/2026-11-24-frontend-container.md`, section 4) | `next.config.mjs`, `src/lib/dev-api-proxy.test.ts` |
| C3 | Main-path e2e tests (section 5) | `e2e/main-path.spec.ts` (new), `e2e/mock-api.ts` |
| C4 | This section and the notes it updates | `docs/2026-11-24-relative-api.md`, `docs/2026-11-24-frontend-container.md` |
