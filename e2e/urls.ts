// O3 e2e: the app (production build, scripts/e2e-serve.mjs). T1-0d: the API is /api on the same address, as in
// production; the tests mock it in the browser (e2e/mock-api.ts), so the build carries no API address at all.
export const E2E_APP_URL = "http://127.0.0.1:3200"
export const E2E_API_URL = `${E2E_APP_URL}/api`
