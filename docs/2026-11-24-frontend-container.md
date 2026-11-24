# The frontend container (T1-L0-FE)

The frontend as a container image, for the local stack (backend repository, `docs/2026-11-23-local-stack.md`) and
later for Azure Container Apps behind Front Door. Files: `Dockerfile`, `.dockerignore`, `.gitattributes`.

## 1. The contract

From the local stack doc, section 3, and how `devstack/compose.yaml` uses the image:

| Requirement | How the image meets it |
|---|---|
| A `Dockerfile` at the repository root | `Dockerfile`; compose builds with this repository as the context (`FRONTEND_REPO`) |
| ~~Takes the build argument `NEXT_PUBLIC_AUTH_API_URL`~~ | Gone with T1-0d (section 6): no API address is built in |
| Serves on port 3000, all interfaces | `PORT=3000`, `HOSTNAME=0.0.0.0` in the image (compose sets the same) |
| Next's `output: 'standalone'` server | `node server.js` from `.next/standalone` |

Since T1-0d the app calls `/api` on the page's own address, so one image serves every customer address. Until the
backend's `compose.yaml` drops its `args` (section 6), compose still passes `NEXT_PUBLIC_AUTH_API_URL`: Docker only
warns that the argument wasn't used.

## 2. The stages

| Stage | Does | Why |
|---|---|---|
| `deps` | `npm ci` from `package.json` and `package-lock.json` only | This layer is reused until the dependencies change |
| `build` | Copies the context, then `npm run build` (`next build` and `scripts/build-sw.mjs`, which writes `public/sw.js`), then `npm run check:build` | One build per image; the image build stops if a backend address or a rewrite is in the output |
| `runner` | Copies only `.next/standalone`, `.next/static` and `public/`, as `deploy.ps1` packages them | No sources, dev dependencies or build cache in the running image |

All three use `node:20.19.6-bookworm-slim` (Node 20, as the stack doc names; an exact tag so a rebuild gets the same
base). The runner runs as the image's `node` user, not root, with `NODE_ENV=production` and telemetry off.

**Health check.** Every 30 seconds the image fetches `http://127.0.0.1:3000/pos/login` with Node's own `fetch` (the
slim image has no curl); 3 failures mark it unhealthy. Compose and Container Apps can use it.

**Build argument.**

| Argument | Required | Effect |
|---|---|---|
| `POS_APP_BUILD_ID` | No | The build id: the heartbeat's `appVersion` and the service worker's cache version. Empty or absent: `next.config.mjs` makes one, `<version>-nogit-<time>` (`.git` isn't in the context, so there is no commit hash). Each build still gets a new id, so tills drop the old cached POS |

To put the commit in the id, pass it: `--build-arg POS_APP_BUILD_ID=0.1.0-$(git rev-parse --short HEAD)-$(Get-Date -UFormat %s)`.

## 3. What the build context leaves out (`.dockerignore`)

| Left out | Why |
|---|---|
| `.env`, `.env.*` (any folder) | Local settings and secrets never go into an image. The build needs none |
| `.git`, `.gitignore`, `.vscode`, `.idea`, `.claude` | Not part of the app |
| `node_modules`, `.next`, `out`, `public/sw.js`, `*.tsbuildinfo`, `next-env.d.ts` | The image installs and builds its own; a local build must not leak in |
| `test-results`, `playwright-report`, `coverage`, `*.zip` | Test output and deploy packages |
| `Dockerfile`, `.dockerignore`, `docs`, `README.md` | Not needed to build |

`e2e/` and `playwright.config.ts` stay in: `next build` type-checks every file `tsconfig.json` includes, and the
Playwright config imports `e2e/urls.ts`.

`public/` holds only the generated `sw.js` (git-ignored), so a fresh clone has no `public/` at all;
`scripts/build-sw.mjs` creates it, so the runner's copy of `public/` always exists.

`.gitattributes` keeps `Dockerfile` and `.dockerignore` with Unix line endings on Windows checkouts
(`core.autocrlf=true` would otherwise convert them).

## 4. How it was checked here (no Docker on this machine)

On 2026-11-23, with Node 24 (the image uses Node 20):

1. **The context.** A script copied the repository into a scratch folder with the `.dockerignore` rules applied as
   Docker applies them (patterns from the context root, `*` within one path segment, `**` across any). Result: 416
   files, 5 MB; no `.env*`, `.git`, `node_modules`, `.next`, `sw.js` or zip.
2. **The build stage.** In that copy (not a git repository, no `.env.local`): `npm ci`, then the `RUN` script with
   `NEXT_PUBLIC_AUTH_API_URL=https://beaconculinary.pos.localhost/api` and an empty `POS_APP_BUILD_ID`. Lint, type
   check and build passed; build id `0.1.0-nogit-…`; `public/sw.js` written.
3. **The argument checks**, run in `sh`: no API address: exit 1 with the message; empty build id: removed (Next makes
   one); a given build id: used.
4. **The runner stage.** The three folders assembled as the `COPY` lines do, then `PORT=3000 HOSTNAME=0.0.0.0 node
   server.js`: `/pos/login`, `/login`, `/board`, `/sw.js` and a static chunk answered 200; the health-check command
   exited 0; the API address was inlined in 8 client chunks and `localhost:8080` in none; no `.env` in the runner.
5. **Repository checks:** lint clean, `tsc` clean, Vitest 142 files and 1,175 tests passed.

Steps 2 to 4 were run for T1-L0-FE, when the image still took `NEXT_PUBLIC_AUTH_API_URL`. T1-0d removed it; the
same build without it, followed by `npm run check:build`, is what `npm run test:e2e` runs (2026-11-24: passed).

Not checked here (needs Docker): the image itself (Node 20, Debian, the `node` user's file permissions, the health
check as Docker runs it), and the image behind Caddy on the stack.

**Known: images are not optimised.** The app has no `sharp`, so in standalone mode Next logs
"'sharp' is required to be installed in standalone mode" and serves `/_next/image` requests unoptimised (the login
picture still loads, `200 image/png`). Azure App Service behaves the same today. Follow-up: add `sharp` as a
dependency, or set `images.unoptimized`.

## 5. On the Docker machine

From the frontend repository, in PowerShell.

**1. Build and run on its own.**

```powershell
docker build -t beacon-frontend:check .        # the log ends with "check:build: no backend address in the build"
docker run -d --name fe-check -p 127.0.0.1:3000:3000 beacon-frontend:check
```

**2. Check it.**

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/pos/login     # 200
curl.exe -s -o NUL -w "%{http_code}`n" http://localhost:3000/sw.js         # 200
Start-Sleep 40; docker inspect --format "{{.State.Health.Status}}" fe-check  # healthy
docker exec fe-check id -u                                                  # 1000 (not 0)
docker exec fe-check sh -c "ls -a /app"                                     # no .env*, no src
docker logs fe-check                                                        # "Ready", no errors
docker rm -f fe-check
```

**3. No address in the image.** The client code calls `/api` and names no backend:

```powershell
docker run --rm beacon-frontend:check sh -c "grep -rl 'localhost:8080' /app/.next /app/public | wc -l"   # 0
```

**4. On the stack.** In the backend repository (`FRONTEND_REPO` pointing at this repository, `FRONTEND_MODE`
blank or `container`):

```powershell
.\devstack\scripts\up.ps1
.\devstack\scripts\status.ps1
```

Then open `https://beaconculinary.pos.localhost/`: the sign-in page with its picture; sign in; the browser's
network tab shows API calls to `https://beaconculinary.pos.localhost/api/...`. `docker compose -p beacon-devstack
logs frontend` shows the server ready and no errors.

## 6. T1-0d (done)

T1-0d makes every API call go to `/api` on the page's own address, so one image serves every customer
(`docs/2026-11-24-relative-api.md`). Done in the `Dockerfile`: `ARG NEXT_PUBLIC_AUTH_API_URL` and its check are gone
(`POS_APP_BUILD_ID` stays), and the build runs `npm run check:build`.

**Backend request (`devstack/compose.yaml`):** drop the frontend service's `args` and the per-customer image tag
(`beacon-devstack/frontend:${ACTIVE_CUSTOMER}` → `beacon-devstack/frontend`), so switching customer reuses the image
instead of rebuilding it; and update the local stack doc's section 3 ("takes the build argument") and host mode (no
`NEXT_PUBLIC_AUTH_API_URL` in `.env.local`).
