// O3: end-to-end tests against the production build (the service worker only runs there). The API is mocked in the
// tests (e2e/mock-api.ts) at E2E_API_URL, which the build is pointed at; nothing listens there.
// Run: npm run test:e2e (builds first, about 2 minutes). Not part of npm test, and never part of the app build.
import { defineConfig, devices } from "@playwright/test"
import { E2E_API_URL, E2E_APP_URL } from "./e2e/urls"

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: E2E_APP_URL,
    serviceWorkers: "allow",
  },
  webServer: {
    command: "npm run build && node scripts/e2e-serve.mjs",
    env: { NEXT_PUBLIC_AUTH_API_URL: E2E_API_URL },
    url: `${E2E_APP_URL}/pos/login`,
    timeout: 420_000,
    reuseExistingServer: false,
    stdout: "ignore",
  },
})
