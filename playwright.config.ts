// O3: end-to-end tests against the production build (the service worker only runs there). T1-0d: the API is /api on
// the app's own address, as in production, mocked in the browser (e2e/mock-api.ts); the build is the one production
// gets, with no API address and no rewrite, and npm run check:build confirms that before the tests start.
// Run: npm run test:e2e (builds first, about 2 minutes). Not part of npm test, and never part of the app build.
// T1-10: STACK_E2E=1 runs only the stack spec (e2e/stack-cross-customer.spec.ts) against the real local stack at the
// addresses it is given: no mock build, no web server. Without it, the stack spec is listed as skipped, with why.
import { defineConfig, devices } from "@playwright/test"
import { E2E_APP_URL } from "./e2e/urls"

const stack = process.env.STACK_E2E === "1"

export default defineConfig({
  testDir: "e2e",
  ...(stack ? { testMatch: /stack-cross-customer\.spec\.ts$/ } : {}),
  workers: 1,
  retries: 0,
  timeout: stack ? 300_000 : 90_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: E2E_APP_URL,
    serviceWorkers: "allow",
  },
  webServer: stack
    ? undefined
    : {
        command: "npm run build && npm run check:build && node scripts/e2e-serve.mjs",
        url: `${E2E_APP_URL}/pos/login`,
        timeout: 420_000,
        reuseExistingServer: false,
        stdout: "ignore",
      },
})
